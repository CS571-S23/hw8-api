
import express from 'express';
import rateLimit from 'express-rate-limit';
import errorHandler from 'errorhandler';
import sqlite3 from 'sqlite3';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import crypto from 'crypto';

import { readFileSync } from 'fs';

const app = express();
const port = 25408;

const COLE_LOCAL = false;
const FS_XID_ASSOCIATIONS = COLE_LOCAL ? "C:/Users/ColeNelson/Desktop/cs571-s23/hws/apis/hw8-api/secret-generation/ref-codes.secret" : "/secrets/ref-codes.secret";

const FS_DB = COLE_LOCAL ? "./db.db" : "/secrets/db.db";
const FS_INIT_SQL = COLE_LOCAL ? "C:/Users/ColeNelson/Desktop/cs571-s23/hws/apis/hw8-api/includes/init.sql" : "/secrets/init.sql";
const INIT_SQL = readFileSync(FS_INIT_SQL).toString();

const FS_PATH = COLE_LOCAL ? "C:/Users/ColeNelson/Desktop/cs571-s23/hws/apis/hw8-api/includes" : "/secrets"

const CREATE_ORDER_SQL = "INSERT INTO BadgerBakeryOrder(username, numMuffin, numDonut, numPie, numCupcake, numCroissant) VALUES(?, ?, ?, ?, ?, ?) RETURNING id, placedOn;";
const GET_ORDERS_SQL = "SELECT * From BadgerBakeryOrder ORDER BY id DESC LIMIT 25;"

const BAKERY_ITEMS = [
    {
        name: "muffin",
        price: 1.50,
        img: "https://www.cs571.org/s23/hw8/api/bakery/images/muffin",
        upperBound: 12
    },
    {
        name: "donut",
        price: 1.00,
        img: "https://www.cs571.org/s23/hw8/api/bakery/images/donut",
        upperBound: 24
    },
    {
        name: "pie",
        price: 6.75,
        img: "https://www.cs571.org/s23/hw8/api/bakery/images/pie",
        upperBound: 6
    },
    {
        name: "cupcake",
        price: 2.00,
        img: "https://www.cs571.org/s23/hw8/api/bakery/images/cupcake",
        upperBound: 12
    },
    {
        name: "croissant",
        price: 0.75,
        img: "https://www.cs571.org/s23/hw8/api/bakery/images/croissant",
        upperBound: 12
    }
];

const BAKERY_ITEM_NAMES = BAKERY_ITEMS.map(bi => bi.name);
const BAKERY_ITEM_LOOKUP = BAKERY_ITEMS.reduce((p, bi) => {
    return {
        ...p,
        [bi.name]:
        {
            ...bi,
            name: undefined
        }
    }
}, {})

// https://stackoverflow.com/questions/14636536/how-to-check-if-a-variable-is-an-integer-in-javascript
function isInt(value) {
    return !isNaN(value) &&
        parseInt(Number(value)) == value &&
        !isNaN(parseInt(value, 10));
}

const XID_ASSOCIATIONS = Object.fromEntries(readFileSync(FS_XID_ASSOCIATIONS)
    .toString().split(/\r?\n/g).map(assoc => {
        const assocArr = assoc.split(',');
        return [assocArr[1], assocArr[0]]
    })
);

const XIDS = Object.keys(XID_ASSOCIATIONS);

const db = await new sqlite3.Database(FS_DB, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.log("Failed to create/open SQL database!");
        exit(1);
    } else {
        console.log("Created/opened SQL database!")
    }
});
db.serialize(() => {
    INIT_SQL.replaceAll(/\t\r\n/g, ' ').split(';').filter(str => str).forEach((stmt) => db.run(stmt + ';'));
});


// LOGGING
app.use(morgan((tokens, req, res) => {
    return [
        tokens.date(),
        tokens['remote-addr'](req, res),
        tokens.method(req, res),
        tokens.url(req, res),
        tokens.status(req, res),
        lookupXid(req.header('X-CS571-ID')),
        tokens['response-time'](req, res), 'ms'
    ].join(' ')
}));

morgan.token('date', function () {
    var p = new Date().toString().replace(/[A-Z]{3}\+/, '+').split(/ /);
    return (p[2] + '/' + p[1] + '/' + p[3] + ':' + p[4] + ' ' + p[5]);
});

process.on('uncaughtException', function (exception) {
    console.log(exception);
});

process.on('unhandledRejection', (reason, p) => {
    console.log("Unhandled Rejection at: Promise ", p, " reason: ", reason);
});

app.use(errorHandler({ dumpExceptions: true, showStack: true }));

// JSON Body Parser Configuration
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

// Request Throttler
app.set('trust proxy', 1);

// Allow CORS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-CS571-ID, Origin, X-Requested-With, Content-Type, Accept");
    next();
});

// Require WISC Badger ID
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        next();
    } else if (BAKERY_ITEM_NAMES.some(bi => req.url.toLowerCase().endsWith(`/images/${bi}`))) {
        next();
    } else if (!req.header('X-CS571-ID')) {
        res.status(401).send({
            msg: "You must specify a header X-CS571-ID!"
        });
    } else if (!XIDS.includes(req.header('X-CS571-ID').toLowerCase())) {
        res.status(401).send({
            msg: "You specified an invalid X-CS571-ID!"
        });
    } else {
        next();
    }
});

// Throttling
app.use(rateLimit({
    message: {
        msg: "Too many requests, please try again later."
    },
    windowMs: 30 * 1000, // 30 seconds
    max: (req, res) => req.method === "OPTIONS" ? 0 : 100, // limit each client to 100 requests every 30 seconds
    keyGenerator: (req, res) => req.header('X-CS571-ID') // throttle on BID
}));

// Endpoints Go Here!

app.get('/api/bakery/items', (req, res) => {
    res.set({
        "Cache-Control": "public, max-age=3600",
        "Expires": new Date(Date.now() + 3600000).toUTCString()
    }).status(200).send(BAKERY_ITEM_LOOKUP);
});

BAKERY_ITEM_NAMES.forEach(bakedGood => {
    app.get(`/api/bakery/images/${bakedGood}`, (req, res) => {
        res.set({
            "Cache-Control": "public, max-age=86400",
            "Expires": new Date(Date.now() + 86400000).toUTCString()
        }).status(200).sendFile(`${FS_PATH}/${bakedGood}.png`);
    });
})

app.get('/api/bakery/order', (req, res) => {
    db.prepare(GET_ORDERS_SQL).run().all((err, rows) => {
        if (!err) {
            res.status(200).send({
                msg: "Successfully got the latest orders!",
                orders: rows
            });
        } else {
            res.status(500).send({
                msg: "The operation failed. The error is provided below. This may be server malfunction; check that your request is valid, otherwise contact CS571 staff.",
                error: err
            });
        }
    });
});

app.post('/api/bakery/order', (req, res) => {
    const username = XID_ASSOCIATIONS[req.header("X-CS571-ID")].toLowerCase().split("@cs.wisc.edu")[0].split("@wisc.edu")[0];
    const requestedItems = Object.keys(req.body);
    if (!requestedItems.some(ri => !BAKERY_ITEM_NAMES.includes(ri))) {
        if (!requestedItems.some(ri => !isInt(req.body[ri]) || parseInt(Number(req.body[ri])) < 0)) {
            if (!requestedItems.some(ri => parseInt(Number(req.body[ri])) > BAKERY_ITEM_LOOKUP[ri].upperBound)) {
                const purchaseAmount = requestedItems.reduce((p, ri) => parseInt(Number(req.body[ri])) + p, 0);
                if (purchaseAmount !== 0) {
                    db.prepare(CREATE_ORDER_SQL).get(username,
                        req.body.muffin ?? 0,
                        req.body.donut ?? 0,
                        req.body.pie ?? 0,
                        req.body.cupcake ?? 0,
                        req.body.croissant ?? 0,
                        (err, resp) => {
                            if (!err) {
                                res.status(200).send({
                                    msg: "Successfully made order!",
                                    id: resp.id,
                                    placedOn: resp.placedOn
                                });
                            } else {
                                res.status(500).send({
                                    msg: "The operation failed. The error is provided below. This may be server malfunction; check that your request is valid, otherwise contact CS571 staff.",
                                    error: err
                                });
                            }
                        });
                } else {
                    res.status(418).send({
                        msg: 'You must order something!'
                    })
                }
            } else {
                res.status(413).send({
                    msg: 'You request too much of us! This is a small town bakery.'
                })
            }
        } else {
            res.status(400).send({
                msg: 'You may only request positive whole numbers of baked goods!'
            })
        }
    } else {
        res.status(400).send({
            msg: `A request may only be made for ${BAKERY_ITEM_NAMES.join(', ')}. Baked goods are case-sensitive (and heat-sensitive!).`
        })
    }
});

// Error Handling
app.use((err, req, res, next) => {
    let datetime = new Date();
    let datetimeStr = `${datetime.toLocaleDateString()} ${datetime.toLocaleTimeString()}`;
    console.log(`${datetimeStr}: Encountered an error processing ${JSON.stringify(req.body)}`);
    res.status(500).send({
        "error-msg": "Oops! Something went wrong. Check to make sure that you are sending a valid request. Your recieved request is provided below. If it is empty, then it was most likely not provided or malformed. If you have verified that your request is valid, please contact the CS571 staff.",
        "error-req": JSON.stringify(req.body),
        "date-time": datetimeStr
    })
});

// XID Lookup
function lookupXid(xId) {
    if (XIDS.includes(xId)) {
        return XID_ASSOCIATIONS[xId];
    } else {
        return "anonymous"
    }
}

// Open Server for Business
app.listen(port, () => {
    console.log(`CS571 API :${port}`)
});
