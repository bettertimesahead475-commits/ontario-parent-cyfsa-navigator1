import fetch from 'node-fetch';
async function run() {
  const res = await fetch('http://localhost:3000/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ textContent: "CAS visited my home today and said it was messy. I was stressed.", model: "gemini-2.5-flash" })
  });
  console.log(res.status);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
run();
