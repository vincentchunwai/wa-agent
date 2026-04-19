module.exports = {
  apps: [
    {
      name: 'wa-agent',
      script: './dist/cli/index.js',
      args: 'start',
      node_args: '--enable-source-maps',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
	OPENROUTER_API_KEY: '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',
	TAVILY_API_KEY: '',
      },
    },
  ],
};
