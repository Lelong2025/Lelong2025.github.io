import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import test from 'node:test';
import { createServer, loadConfigFromFile } from 'vite';

test('local API proxy supplies the frontend Origin for GETs and preserves explicit origins', async () => {
    const backend = createHttpServer((request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ origin: request.headers.origin, host: request.headers.host }));
    });
    await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
    let frontend;
    try {
        const target = `http://127.0.0.1:${backend.address().port}`;
        const { config } = await loadConfigFromFile({ command: 'serve', mode: 'test' });
        frontend = await createServer({
            ...config,
            configFile: false,
            server: {
                ...config.server, host: '127.0.0.1', port: 5189, open: false,
                proxy: { '/api': { ...config.server.proxy['/api'], target } }
            }
        });
        await frontend.listen();
        const origin = `http://127.0.0.1:${frontend.httpServer.address().port}`;
        const implicit = await fetch(`${origin}/api/admin/dashboard`).then(response => response.json());
        assert.equal(implicit.origin, origin);
        assert.equal(implicit.host, new URL(target).host);
        const explicit = await fetch(`${origin}/api/admin/dashboard`, {
            headers: { Origin: 'https://external.example' }
        }).then(response => response.json());
        assert.equal(explicit.origin, 'https://external.example');
    } finally {
        await frontend?.close();
        await new Promise(resolve => backend.close(resolve));
    }
});
