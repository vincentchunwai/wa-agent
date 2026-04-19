module.exports = {
  apps: [
    {
      name: 'wa-agent',
      script: './dist/cli/index.js',
      node_args: '--enable-source-maps',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
