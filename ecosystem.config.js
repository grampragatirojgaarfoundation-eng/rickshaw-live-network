module.exports = {
  apps: [{
    name: "rickshaw-app",
    script: "./server.js",
    instances: "max",
    exec_mode: "cluster",
    env: {
      NODE_ENV: "production"
    }
  }]
}