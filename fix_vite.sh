sed -i '1561c\
    const { createServer: createViteServer } = await import("vite");\
    const vite = await createViteServer({' server.ts
