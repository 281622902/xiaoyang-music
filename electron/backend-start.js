async function listenAvailable(server, preferred = 35211) {
  const listen = port => new Promise((resolve, reject) => {
    const fail = error => { server.removeListener('listening', ready); reject(error); };
    const ready = () => { server.removeListener('error', fail); resolve(server.address().port); };
    server.once('error', fail); server.once('listening', ready); server.listen(port, '127.0.0.1');
  });
  try { return await listen(Number(preferred)); }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; return listen(0); }
}
module.exports = { listenAvailable };
