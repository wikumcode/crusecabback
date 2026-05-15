module.exports = {
  apps: [
    {
      name: 'cruisecabs-backend',
      script: 'src/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 5003
      }
    }
  ]
};
