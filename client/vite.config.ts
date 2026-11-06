import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // 같은 와이파이의 다른 컴퓨터에서도 접속 가능
    port: 5173,
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
});
