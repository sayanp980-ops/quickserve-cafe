
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const {
    connectDatabase,
    getDatabase,
    saveDatabase
} = require('./db');

const root = __dirname;
const configuredPort = process.env.PORT
    ? Number(process.env.PORT)
    : 3000;

const allowedStatuses = new Set([
    'pending',
    'preparing',
    'ready',
    'delivered'
]);

const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
};

if (!Number.isInteger(configuredPort) ||
    configuredPort < 1 ||
    configuredPort > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
}

function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8'
    });
    response.end(JSON.stringify(data));
}

async function readJson(request) {
    const chunks = [];
    let size = 0;

    for await (const chunk of request) {
        size += chunk.length;

        if (size > 1024 * 1024) {
            const error = new Error('Request body exceeds 1 MB');
            error.statusCode = 413;
            throw error;
        }

        chunks.push(chunk);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        const error = new Error('Request body must be valid JSON');
        error.statusCode = 400;
        throw error;
    }
}

async function handleApi(request, response, pathname) {

    if (request.method === 'GET' &&
        ['/menu', '/tables', '/categories', '/meta', '/orders'].includes(pathname)) {

        const database = await getDatabase();

        if (pathname === '/menu') {
            sendJson(response, 200, database.menu || []);
            return true;
        }

        if (pathname === '/tables') {
            const tables = (database.tables || []).map(table => ({
                ...table,
                id: Number(table.id),
                seats: Number(table.seats)
            }));

            sendJson(response, 200, tables);
            return true;
        }

        if (pathname === '/categories') {
            sendJson(response, 200, database.categories || []);
            return true;
        }

        if (pathname === '/meta') {
            sendJson(response, 200, database.meta || {});
            return true;
        }

        if (pathname === '/orders') {
            sendJson(response, 200, database.orders || []);
            return true;
        }
    }

    if (request.method === 'POST' && pathname === '/orders') {

        const order = await readJson(request);

        if (!Array.isArray(order.items) || order.items.length === 0) {
            sendJson(response, 400, {
                error: 'Order must include at least one item'
            });
            return true;
        }

        const tableNo = Number(order.tableNo);

        if (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > 15) {
            sendJson(response, 400, {
                error: 'Order must specify a valid table number (1-15)'
            });
            return true;
        }

        const database = await getDatabase();

        const calculatedSubtotal = order.items.reduce(
            (sum, item) =>
                sum + (Number(item.price) || 0) * (Number(item.qty) || 1),
            0
        );

        const subtotal = Number.isFinite(order.subtotal)
            ? Number(order.subtotal)
            : calculatedSubtotal;

        const tax = Number.isFinite(order.tax)
            ? Number(order.tax)
            : Math.round(subtotal * 0.05 * 100) / 100;

        const total = Number.isFinite(order.total)
            ? Number(order.total)
            : subtotal + tax;

        const createdOrder = {
            id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
            tableNo,
            status: 'pending',

            items: order.items.map(item => ({
                id: String(item.id || item.menuId || ''),
                name: item.name,
                price: Number(item.price),
                qty: Number(item.qty),
                veg: Boolean(item.veg),
                category: item.category || 'General'
            })),

            subtotal,
            tax,
            total,
            paymentMode: order.paymentMode || 'cash',
            createdAt: new Date().toISOString()
        };

        database.orders = database.orders || [];
        database.orders.push(createdOrder);

        await saveDatabase(database);

        sendJson(response, 201, createdOrder);
        return true;
    }

    const orderStatusRoute = pathname.match(/^\/orders\/([^/]+)$/);

    if (request.method === 'PATCH' && orderStatusRoute) {

        const orderId = decodeURIComponent(orderStatusRoute[1]);
        const update = await readJson(request);

        const status = typeof update.status === 'string'
            ? update.status.toLowerCase().trim()
            : '';

        if (!allowedStatuses.has(status)) {
            sendJson(response, 400, {
                error: `Invalid order status. Allowed: ${Array.from(allowedStatuses).join(', ')}`
            });
            return true;
        }

        const database = await getDatabase();

        const orderIndex = (database.orders || []).findIndex(
            order => String(order.id) === orderId
        );

        if (orderIndex === -1) {
            sendJson(response, 404, {
                error: 'Order not found'
            });
            return true;
        }

        database.orders[orderIndex] = {
            ...database.orders[orderIndex],
            status
        };

        await saveDatabase(database);

        sendJson(response, 200, database.orders[orderIndex]);
        return true;
    }

    if (
        pathname === '/menu' ||
        pathname === '/tables' ||
        pathname === '/categories' ||
        pathname === '/meta' ||
        pathname === '/orders' ||
        pathname.startsWith('/orders/')
    ) {
        sendJson(response, 405, {
            error: 'Method not allowed'
        });
        return true;
    }

    return false;
}

async function serveStatic(request, response, pathname) {

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, {
            error: 'Method not allowed'
        });
        return;
    }

    const relativeUrlPath = pathname === '/'
        ? '/index.html'
        : pathname;

    const filePath = path.resolve(root, `.${relativeUrlPath}`);
    const relativePath = path.relative(root, filePath);

    if (
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
    ) {
        sendJson(response, 404, {
            error: 'Not found'
        });
        return;
    }

    let file;

    try {
        file = await fs.promises.readFile(filePath);
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'EISDIR') {
            sendJson(response, 404, {
                error: 'Not found'
            });
            return;
        }

        throw error;
    }

    response.writeHead(200, {
        'Content-Type':
            contentTypes[path.extname(filePath)] ||
            'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
    });

    response.end(request.method === 'HEAD' ? undefined : file);
}

const server = http.createServer(async (request, response) => {

    try {
        const url = new URL(
            request.url,
            `http://${request.headers.host || 'localhost'}`
        );

        const pathname = decodeURIComponent(url.pathname);

        const handled = await handleApi(request, response, pathname);

        if (!handled) {
            await serveStatic(request, response, pathname);
        }

    } catch (error) {

        if (response.headersSent) {
            response.destroy(error);
            return;
        }

        if (error.statusCode) {
            sendJson(response, error.statusCode, {
                error: error.message
            });
            return;
        }

        console.error('Request failed:', error);

        sendJson(response, 500, {
            error: 'Internal server error'
        });
    }
});

function listen(port) {

    const onListening = () => {
        console.log(
            `QuickServe frontend and API are running at http://localhost:${server.address().port}`
        );
    };

    server.once('error', error => {

        server.removeListener('listening', onListening);

        if (error.code === 'EADDRINUSE' &&
            !process.env.PORT &&
            port < 65535) {

            console.warn(`Port ${port} is busy; trying ${port + 1}`);
            listen(port + 1);
            return;
        }

        console.error(
            `Unable to start QuickServe on port ${port}:`,
            error.message
        );

        process.exitCode = 1;
    });

    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
}

if (require.main === module) {

    connectDatabase()
        .then(() => listen(configuredPort))
        .catch(error => {
            console.error('Database connection failed:', error.message);
            process.exitCode = 1;
        });
}

module.exports = {
    server,
    handleApi,
    serveStatic,
    listen
};
