function write(level, event, fields = {}) {
  const record = { timestamp: new Date().toISOString(), level, event, ...fields };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (event, fields) => write('info', event, fields),
  error: (event, fields) => write('error', event, fields),
};
