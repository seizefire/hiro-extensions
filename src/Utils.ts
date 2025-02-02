import { RequestManager, Response } from "@paperback/types";

/**
 * Sends a GET request and receives a response
 * @param url The URL
 * @param requestManager The request manager
 * @param referer The value to use for the referer header (defaults to the URL)
 * @returns The HTTP response
 */
export async function sendGetRequest(url: string, requestManager: RequestManager, referer: string = url): Promise<Response> {
  // make the request
  const request = App.createRequest({
    url: url,
    method: 'GET',
    headers: {
      'Referer': referer,
      'User-Agent': await requestManager.getDefaultUserAgent()
    }
  });
  // did we find the manga
  return await requestManager.schedule(request, 5);
}

/**
 * Checks the status code of the HTTP response
 * @param response The HTTP response
 * @param purpose The purpose of the request (for use in the error messages)
 * @returns The response body, if the request was successful
 */
export function validateResponse(response: Response, purpose: string): string {
  switch(response.status){
    case 200:
      return response.data!;
    case 403:
      throw new Error(`HTTP 403 Unauthorized - Please report if you see this [${purpose}]`);
    case 404:
      throw new Error(`HTTP 404 Not Found [${purpose}]`);
    case 503:
      throw new Error(`HTTP 503 Service Temporarily Unavailable - Please report if you see this [${purpose}]`);
    default:
      throw new Error(`HTTP ${response.status} Unknown Error [${purpose}]`);
  }
}

/**
 * Checks the status code of the HTTP response, and attempts to parse the body as JSON
 * @param response The HTTP response
 * @param purpose The purpose of the request (for use in the error messages)
 * @returns The parsed response body, if the request was successful
 */
export function validateJSONResponse(response: Response, purpose: string): any {
  var body = validateResponse(response, purpose);
  try {
    return JSON.parse(body);
  }catch(err){
    throw new Error(`Response is not valid JSON [${purpose}]`);
  }
}