'use strict'

const express = require('express')
const path = require('path');

const { PORT = '8080' } = process.env

const app = express()
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname+'/index.html'));
});
app.get('/testpage', (req, res) => {
    res.sendFile(path.join(__dirname+'/index.html'));
});
app.listen(PORT)



