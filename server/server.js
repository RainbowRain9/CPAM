const { createServerApp } = require('./app');

const { app, port, startBackgroundServices } = createServerApp();
const server = app.listen(port);

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`API Center 启动失败：端口 ${port} 已被占用`);
    process.exit(1);
  }

  console.error('API Center 启动失败:', error);
  process.exit(1);
});

server.on('listening', () => {
  console.log(`API Center 服务运行在 http://localhost:${port}`);
  startBackgroundServices();
});
