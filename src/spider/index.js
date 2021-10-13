'use strict'
//node 模块 提供udp
const dgram = require('dgram')
const Emiter = require('events')
// 根据BitTorrent规范，用于编码和解码本编码数据的节点库。
const bencode = require('bencode')
const { Table, Node } = require('./table')
const Token = require('./token')

const bootstraps = [{
    address: 'router.bittorrent.com',
    port: 6881
}, {
    address: 'dht.transmissionbt.com',
    port: 6881
}]

function isValidPort(port) {
    return port > 0 && port < (1 << 16)
}

function generateTid() {
    return parseInt(Math.random() * 99).toString()
}

class Spider extends Emiter {
    constructor() {
        super()
        const options = arguments.length ? arguments[0] : {}
        this.table = new Table(options.tableCaption || 600)
        this.bootstraps = options.bootstraps || bootstraps
        this.token = new Token()
        this.walkTimeout = null
        this.joinInterval = null
    }

    send(message, address) {
        const data = bencode.encode(message)
        this.udp.send(data, 0, data.length, address.port, address.address)
    }

    findNode(id, address) {
        const message = {
            t: generateTid(),
            y: 'q',
            q: 'find_node',
            a: {
                id: id,
                target: Node.generateID()
            }
        }
        this.send(message, address)
    }

    join() {
        this.bootstraps.forEach((b) => {
            this.findNode(this.table.id, b)
        })
    }

    walk() {
        const node = this.table.shift()
        const nodes = this.table.getnodes()
        if (node) {
            this.findNode(Node.neighbor(node.id, this.table.id), { address: node.address, port: node.port })
        }
        this.walkTimeout = setTimeout(
            () => {
                if (nodes.length < 1000) {
                    this.walk()
                }
            }, 200)
    }

    onFoundNodes(data) {
        const nodes = Node.decodeNodes(data)
        nodes.forEach((node) => {
            if (node.id != this.table.id && isValidPort(node.port)) {
                this.table.add(node)
            }
        })
        this.emit('nodes', nodes)
    }

    onFindNodeRequest(message, address) {
        const { t: tid, a: { id: nid, target: infohash } } = message

        if (tid === undefined || target.length != 20 || nid.length != 20) {
            return
        }
        this.send({
            t: tid,
            y: 'r',
            r: {
                id: Node.neighbor(nid, this.table.id),
                nodes: Node.encodeNodes(this.table.first())
            }
        }, address)
    }

    onGetPeersRequest(message, address) {
        const { t: tid, a: { id: nid, info_hash: infohash } } = message

        if (tid === undefined || infohash.length != 20 || nid.length != 20) {
            return
        }

        this.send({
            t: tid,
            y: 'r',
            r: {
                id: Node.neighbor(nid, this.table.id),
                nodes: Node.encodeNodes(this.table.first()),
                token: this.token.token
            }
        }, address)

        this.emit('unensureHash', infohash.toString('hex').toUpperCase())
    }

    onAnnouncePeerRequest(message, address) {
        let { t: tid, a: { info_hash: infohash, token: token, id: id, implied_port: implied, port: port } } = message
        if (!tid) return

        if (!this.token.isValid(token)) return

        port = (implied != undefined && implied != 0) ? address.port : (port || 0)
        if (!isValidPort(port)) return

        this.send({ t: tid, y: 'r', r: { id: Node.neighbor(id, this.table.id) } }, address)

        this.emit('ensureHash', infohash.toString('hex').toUpperCase(), {
            address: address.address,
            port: port
        })
    }

    onPingRequest(message, addr) {
        this.send({ t: message.t, y: 'r', r: { id: Node.neighbor(message.a.id, this.table.id) } })
    }

    parse(data, address) {
        try {
            const message = bencode.decode(data)
            if (message.y.toString() == 'r' && message.r.nodes) {
                this.onFoundNodes(message.r.nodes)
            } else if (message.y.toString() == 'q') {
                switch (message.q.toString()) {
                    // A向B查询某个infoHash(可以理解为一个Torrent的id,也是由20个字节组成.该20个字节并非随机,
                    //是由Torrent文件中的metadata字段(该字段包含了文件的主要信息,
                    // 也就是上文提到的名字/长度/子文件目录/子文件长度等信息,实际上一个磁力搜索网站提供的也就是这些信息).进行SH1编码生成的). 如果B拥有该infoHash的信息,则返回该infoHash
                    // 的peers(也就是可以从这些peers处下载到该种子和文件). 如果没有,则返回离该infoHash最近的8个node信息. 然后 A节点可继续向这些node发送请求.
                    case 'get_peers':
                        this.onGetPeersRequest(message, address)
                        break
                        //可能要放到云服务器上才会被执行，都归咎于内网问题.
                        //A通知B(以及其他若干节点)自己拥有某个infoHash的资源(也就是A成为该infoHash的peer,可提供文件或种子的下载),并给B发送下载的端口.
                    case 'announce_peer':
                        this.onAnnouncePeerRequest(message, address)
                        break
                        //A向B查询某个nodeId. B需要从自己的路由表中找到对应的nodeId返回,或者返回离该nodeId最近的8个node信息.
                        // 然后A节点可以再向B节点继续发送find_node请求
                    case 'find_node':
                        this.onFindNodeRequest(message, address)
                        // A向B发送请求,测试对方节点是否存活. 如果B存活,需要响应对应报文
                    case 'ping':
                        this.onPingRequest(message, address)
                        break
                }
            }
        } catch (err) {}
    }
    destroy() {
        this.walkTimeout && clearTimeout(this.walkTimeout)
        this.joinInterval && clearInterval(this.joinInterval)
        this.udp.close()
    }
    RandomNum(Min, Max) {
        var Range = Max - Min;
        var Rand = Math.random();
        if (Math.round(Rand * Range) == 0) {
            return Min + 1;
        }
        var num = Min + Math.round(Rand * Range);
        return num;
    }
    listen() {
        this.udp = dgram.createSocket('udp4')
        var port = 4048

        this.udp.bind(port)
        this.udp.on('listening', () => {
            console.log(`Listen on ${this.udp.address().address}:${this.udp.address().port}`)
        })
        this.udp.on('message', (data, addr) => {
            this.parse(data, addr)
        })
        this.udp.on('error', (err) => {})
        this.joinInterval = setInterval(() => this.join(), 3000)
        this.join()
        this.walk()
    }
}

module.exports = Spider