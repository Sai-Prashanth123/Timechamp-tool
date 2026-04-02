module.exports = {
  apps: [
    {
      name: 'timechamp-api',
      script: 'dist/main.js',
      cwd: '/home/ubuntu/timechamp/apps/api',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/timechamp/api-error.log',
      out_file: '/var/log/timechamp/api-out.log',
      merge_logs: true,
    },
  ],
}
