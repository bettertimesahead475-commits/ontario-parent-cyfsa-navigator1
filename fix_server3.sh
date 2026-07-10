sed -i '882d' server.ts
sed -i '1553i\
async function setupViteAndStart() {' server.ts
sed -i '1592d' server.ts
