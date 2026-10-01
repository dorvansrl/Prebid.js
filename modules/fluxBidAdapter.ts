/**
 * fluxBidAdapter.ts
 * Prebid.js Adapter for Flux Bidder
 *
 * Sends an OpenRTB 2.6 bid request and reads an OpenRTB 2.6 bid response.
 */

import { deepSetValue, logError, logInfo, logWarn } from '../src/utils.js';
import { type BidderSpec, registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER } from '../src/mediaTypes.js';
import { ortbConverter } from '../libraries/ortbConverter/converter.js';
import { toOrtb26 } from '../libraries/ortb2.5Translator/translator.js';
import { getConnectionType } from '../libraries/connectionInfo/connectionUtils.js';

const BIDDER_CODE = 'flux';
// IAB TCF Global Vendor List ID for Flux.
const GVLID = 1654;
const ENDPOINT_URL = 'https://a.fluxtech.ai/hb/bid';
const SYNC_URL = 'https://a.fluxtech.ai/sync';
const DEFAULT_TTL = 300;
const DEFAULT_CURRENCY = 'EUR';
const TEST_FLAG = 'fluxTest=1';

// OpenRTB 2.6 device types (AdCOM List: Device Types).
const DEVICE_TYPE_PC = 2;
const DEVICE_TYPE_PHONE = 4;
const DEVICE_TYPE_TABLET = 5;

export interface FluxBidParams {
  publisherId: string;
  siteDomain?: string;
  placementId?: string;
  safeFrame?: boolean;
}

declare module '../src/adUnits' {
  interface BidderParams {
    [BIDDER_CODE]: FluxBidParams;
  }
}

const safeDocument = (): Document | undefined =>
  typeof document !== 'undefined' ? document : undefined;

const getMetaProperties = (property: string): string[] => {
  const metas = safeDocument()?.querySelectorAll<HTMLMetaElement>(`meta[property="${property}"]`) ?? [];
  return Array.from(metas).map((meta) => meta.content).filter(Boolean);
};

export const getDeviceType = (ua: string, sua?: { mobile?: number }): number => {
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    return DEVICE_TYPE_TABLET;
  }
  if (sua?.mobile === 1 || /Mobile|iPhone|iPod|Android/i.test(ua)) {
    return DEVICE_TYPE_PHONE;
  }
  return DEVICE_TYPE_PC;
};

const isTestMode = (bidderRequest): boolean => {
  const pageHref: string = bidderRequest.refererInfo?.page ?? '';
  const windowHref = typeof window !== 'undefined' ? window.location?.href ?? '' : '';
  return pageHref.includes(TEST_FLAG) || windowHref.includes(TEST_FLAG);
};

// Fill site fields Prebid's first-party-data enrichment doesn't cover, using article meta tags.
const enrichSite = (site) => {
  if (!site) return;
  if (!site.keywords) {
    const tags = getMetaProperties('article:tag');
    if (tags.length > 0) {
      site.keywords = tags.join(',');
    }
  }
  if (!site.ext?.data?.section) {
    const [section] = getMetaProperties('article:section');
    if (section) {
      deepSetValue(site, 'ext.data.section', section);
    }
  }
};

const enrichDevice = (request) => {
  const device = request.device ?? (request.device = {});
  if (device.connectiontype == null) {
    // 0 (unknown) when the Network Information API is missing, e.g. Safari and Firefox.
    const connectionType = getConnectionType();
    if (connectionType) {
      device.connectiontype = connectionType;
    }
  }
  if (device.devicetype == null) {
    device.devicetype = getDeviceType(device.ua ?? '', device.sua);
  }
};

const converter = ortbConverter<typeof BIDDER_CODE>({
  context: {
    mediaType: BANNER,
    netRevenue: true,
    ttl: DEFAULT_TTL,
    currency: DEFAULT_CURRENCY,
  },
  imp(buildImp, bidRequest, context) {
    const imp = buildImp(bidRequest, context);
    const { publisherId, placementId, siteDomain } = bidRequest.params;
    if (placementId) {
      imp.tagid = placementId;
    }
    deepSetValue(imp, 'ext.bidder', {
      publisherId,
      ...(placementId ? { placementId } : {}),
      ...(siteDomain ? { siteDomain } : {}),
    });
    deepSetValue(imp, 'ext.adunitcode', bidRequest.adUnitCode);
    return imp;
  },
  request(buildRequest, imps, bidderRequest, context) {
    const request = buildRequest(imps, bidderRequest, context);
    enrichSite(request.site);
    enrichDevice(request);
    if (isTestMode(bidderRequest)) {
      request.test = 1;
      logInfo('Flux: Test mode activated via fluxTest=1');
    }
    return request;
  },
  bidResponse(buildBidResponse, bid, context) {
    const bidResponse = buildBidResponse(bid, context);
    if (context.ortbRequest?.test === 1) {
      bidResponse.adserverTargeting = { fluxBidderTest: '1' };
    }
    return bidResponse;
  },
});

const isBidRequestValid = (bid) => {
  if (!bid.params?.publisherId) {
    logError('Flux: Missing required parameter publisherId');
    return false;
  }
  if (bid.params.safeFrame === true) {
    logWarn('Flux bidder is not compatible with SafeFrame');
    return false;
  }
  if (!bid.mediaTypes?.banner?.sizes?.length) {
    logError('Flux: No banner sizes specified');
    return false;
  }
  return true;
};

const buildRequests = (validBidRequests, bidderRequest) => {
  const data = toOrtb26(converter.toORTB({ bidRequests: validBidRequests, bidderRequest }));
  return {
    method: 'POST' as const,
    url: ENDPOINT_URL,
    data,
    options: {
      contentType: 'text/plain',
      withCredentials: true,
    },
  };
};

const interpretResponse = (serverResponse, request) => {
  if (!serverResponse?.body?.seatbid) {
    return [];
  }
  return converter.fromORTB({ request: request.data, response: serverResponse.body });
};

const getUserSyncs = (
  syncOptions: { iframeEnabled?: boolean; pixelEnabled?: boolean },
  _serverResponses,
  gdprConsent?: { gdprApplies?: boolean; consentString?: string },
  uspConsent?: string,
) => {
  const syncs: { type: 'iframe' | 'image'; url: string }[] = [];

  if (!syncOptions.iframeEnabled) {
    return syncs;
  }

  const params: string[] = [];
  if (gdprConsent) {
    params.push(`gdpr=${gdprConsent.gdprApplies ? 1 : 0}`);
    params.push(`gdpr_consent=${encodeURIComponent(gdprConsent.consentString ?? '')}`);
  }
  if (uspConsent) {
    params.push(`us_privacy=${encodeURIComponent(uspConsent)}`);
  }

  const syncUrl = params.length > 0 ? `${SYNC_URL}?${params.join('&')}` : SYNC_URL;
  syncs.push({ type: 'iframe', url: syncUrl });
  return syncs;
};

export const spec: BidderSpec<typeof BIDDER_CODE> = {
  code: BIDDER_CODE,
  gvlid: GVLID,
  supportedMediaTypes: [BANNER],
  isBidRequestValid,
  buildRequests,
  interpretResponse,
  getUserSyncs,
};

registerBidder(spec);
