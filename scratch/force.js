const chatId = '70081082085506@lid';
fetch('http://localhost:3000/api/reply-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId })
})
.then(r => r.json())
.then(data => {
    console.log("Draft from AI:", data);
    if(data.message) {
        return fetch('http://localhost:3000/api/reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId, message: data.message })
        }).then(r => r.json());
    }
})
.then(result => {
    console.log("Sent reply:", result);
})
.catch(console.error);
