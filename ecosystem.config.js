module.exports = {
  apps: [{
    name: 'whatsapp-ai-bot',
    script: 'src/index.js',
    watch: true,
    ignore_watch: [
      'node_modules',
      'data',
      '.wwebjs_auth',
      '.wwebjs_cache',
      'logs',
      '*.log',
      'media',
      'media/*',
      'media/**/*'
    ],
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    time: true,
    restart_delay: 5000 // Give it some time before restarting to avoid spam
  }]
};
