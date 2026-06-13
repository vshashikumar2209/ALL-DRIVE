import colors from 'colors';
const methodColors = {
    GET: 'green',
    POST: 'blue',
    PUT: 'yellow',
    DELETE: 'red'
};

const logger = (req, res, next) => {
    const color = methodColors[req.method] || 'white';
    const line = `${req.method} ${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const colorize = colors[color] || ((s) => s);
    console.log(colorize(line));
    next();
};

export default logger;
