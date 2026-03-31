module.exports = {
  apps: [
    {
      name: "instantlly-backend",
      script: "dist/index.js",
      cwd: "/home/ubuntu/instantlly-backend",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
      },
      // Restart if memory exceeds 1.5GB per instance
      max_memory_restart: "1500M",
      // Auto-restart on crash
      autorestart: true,
      // Wait 5s between restarts
      restart_delay: 5000,
      // Max 15 restarts in 15 minutes before stopping
      max_restarts: 15,
      min_uptime: "10s",
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      // Logging
      error_file: "/home/ubuntu/logs/pm2-error.log",
      out_file: "/home/ubuntu/logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      // Watch (disabled in production)
      watch: false,
    },
  ],
};
