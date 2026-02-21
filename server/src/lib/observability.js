function serializeError(error) {
  if (!error) {
    return {};
  }

  return {
    message: error.message,
    code: error.code,
    detail: error.detail,
    constraint: error.constraint,
  };
}

function logInfo(event, fields = {}) {
  console.log(
    JSON.stringify({
      level: 'info',
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    })
  );
}

function logError(event, error, fields = {}) {
  console.error(
    JSON.stringify({
      level: 'error',
      event,
      timestamp: new Date().toISOString(),
      ...fields,
      error: serializeError(error),
    })
  );
}

module.exports = {
  logInfo,
  logError,
};
