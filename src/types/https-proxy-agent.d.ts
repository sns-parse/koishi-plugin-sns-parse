/** https-proxy-agent v7+ 仅通过 package.json exports 暴露类型，Node10 经典解析读不到；
 *  这里给工程当前 moduleResolution 提供等价声明（运行时行为以包本身为准） */
declare module 'https-proxy-agent' {
  import { Agent } from 'http'
  export class HttpsProxyAgent extends Agent {
    constructor(uri: string, opts?: Record<string, any>)
  }
}
