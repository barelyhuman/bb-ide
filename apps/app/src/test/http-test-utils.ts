import { vi } from "vitest"

export interface FetchRoute {
  handler: (request: Request) => Response | Promise<Response>
  method?: string
  pathname: string
  port?: number
}

function normalizeMethod(method: string | undefined): string {
  return (method ?? "GET").toUpperCase()
}

function resolvePort(url: URL): number {
  if (url.port) {
    return Number.parseInt(url.port, 10)
  }

  return url.protocol === "https:" ? 443 : 80
}

function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) {
    return input
  }

  if (input instanceof URL) {
    return new Request(input.toString(), init)
  }

  const requestUrl = /^[a-z]+:\/\//iu.test(input)
    ? input
    : new URL(input, "http://localhost").toString()

  return new Request(requestUrl, init)
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  })
}

export function installFetchRoutes(routes: FetchRoute[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = toRequest(input, init)
    const url = new URL(request.url)
    const requestMethod = normalizeMethod(request.method)
    const requestPort = resolvePort(url)

    const matchingRoute = routes.find((route) =>
      normalizeMethod(route.method) === requestMethod
      && route.pathname === url.pathname
      && (route.port === undefined || route.port === requestPort),
    )

    if (!matchingRoute) {
      throw new Error(`Unhandled fetch: ${requestMethod} ${url.toString()}`)
    }

    return matchingRoute.handler(request)
  })

  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}
