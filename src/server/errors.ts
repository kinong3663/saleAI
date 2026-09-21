/** 资源不存在，或不属于该租户。路由层统一映射成 404 —— 这两种情况对外不区分。 */
export class NotFoundError extends Error {
  constructor(message = 'not_found') {
    super(message)
    this.name = 'NotFoundError'
  }
}
