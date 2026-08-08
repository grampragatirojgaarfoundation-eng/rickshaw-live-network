module.exports = {
  apps: [{
    name: "rickshaw-network",
    script: "./server.js",
    instances: "max",
    exec_mode: "cluster"
  }]
}