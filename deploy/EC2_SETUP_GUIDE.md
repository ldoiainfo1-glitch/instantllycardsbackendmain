# EC2 Deployment Guide — Instantlly Backend

## Step 1: Launch EC2 Instance

1. Go to **AWS Console → EC2 → Launch Instance**
2. Settings:
   - **Name**: `instantlly-backend`
   - **AMI**: Ubuntu Server 24.04 LTS (HVM), SSD Volume Type
   - **Instance type**: `t3.medium` (2 vCPU, 4GB RAM)
   - **Key pair**: Create new or use existing `.pem` key
   - **Network settings**:
     - Allow SSH (port 22) from your IP
     - Allow HTTP (port 80) from anywhere
     - Allow HTTPS (port 443) from anywhere
     - Allow Custom TCP (port 8080) from anywhere (temporary, remove after Nginx setup)
   - **Storage**: 30 GB gp3

3. Click **Launch Instance**
4. Note the **Public IPv4 address** (e.g., `13.232.xxx.xxx`)

## Step 2: Point Domain to EC2

1. Go to your **DNS provider** (Route 53, Cloudflare, GoDaddy, etc.)
2. Create an **A record**:
   - **Name**: `backend` (for `backend.instantllycards.com`)
   - **Value**: Your EC2 public IP
   - **TTL**: 300

3. Wait a few minutes for DNS propagation. Test with:
   ```bash
   nslookup backend.instantllycards.com
   ```

## Step 3: SSH into EC2

```bash
# From your local machine (Git Bash or WSL on Windows)
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
```

## Step 4: Run Server Setup

Once SSHed in, upload and run the setup script:

```bash
# Option A: Copy setup script from local
scp -i your-key.pem deploy/setup-server.sh ubuntu@<EC2_PUBLIC_IP>:~/

# Then SSH in and run:
chmod +x ~/setup-server.sh
sudo ~/setup-server.sh
```

## Step 5: Deploy Application Code

From your **local machine** (Git Bash / WSL):

```bash
# First deployment:
cd instantllycardsbackendmain
bash deploy/deploy.sh <EC2_PUBLIC_IP> /path/to/your-key.pem

# Subsequent deployments (same command):
bash deploy/deploy.sh <EC2_PUBLIC_IP> /path/to/your-key.pem
```

## Step 6: Set Up SSL (HTTPS)

SSH into the server:

```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>

# Run certbot for SSL
sudo certbot --nginx -d backend.instantllycards.com

# Follow the prompts:
# - Enter your email
# - Agree to terms
# - Choose to redirect HTTP to HTTPS (option 2)

# Test auto-renewal
sudo certbot renew --dry-run
```

## Step 7: Verify

```bash
# Health check
curl https://backend.instantllycards.com/

# Should return:
# {"message":"Instantlly API running","version":"2.0.0"}
```

## Post-Setup: Remove Port 8080

After Nginx + SSL is working, go back to **EC2 Security Groups** and **remove the port 8080 rule**. All traffic should go through Nginx (ports 80/443).

## Useful Commands

```bash
# SSH into server
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>

# Check app status
pm2 status
pm2 logs instantlly-backend

# Restart app
pm2 restart instantlly-backend

# View Nginx logs
sudo tail -f /var/log/nginx/instantlly_access.log
sudo tail -f /var/log/nginx/instantlly_error.log

# Check Nginx config
sudo nginx -t
sudo systemctl reload nginx

# Redeploy (from local machine)
bash deploy/deploy.sh <EC2_PUBLIC_IP> /path/to/your-key.pem
```
