// Transpiles the browser ES modules in public/ so Jest (CommonJS) can import them
module.exports = {
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]]
};
