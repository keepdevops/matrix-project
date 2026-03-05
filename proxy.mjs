import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
app.use(cors());

app.use('/', createProxyMiddleware({
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
    on: {
        proxyRes: (proxyRes, req) => {
            console.log(`[Proxy] ${req.method} ${req.url} -> ${proxyRes.statusCode}`);
        }
    }
}));

app.listen(3002, '0.0.0.0', () => {
    console.log("🚀 Proxy Relay active on http://localhost:3002");
});
