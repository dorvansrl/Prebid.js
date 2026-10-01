# Overview

```
Module Name:  Flux Bidder Adapter
Module Type:  Bidder Adapter
Maintainer: bidder@fluxtech.ai
```

# Description

The Flux bid adapter sends a single OpenRTB 2.6 bid request per auction to Flux's auction endpoint and reads an OpenRTB 2.6 response. It supports banner ads only.

The request carries Prebid's first-party data plus TCF consent (Flux is IAB TCF vendor 1654), US Privacy, GPP and COPPA signals, the supply chain object and user IDs, all in their OpenRTB 2.6 locations. Bids are returned in EUR, net revenue. Floors from the Price Floors module are respected (Flux only compares floors in EUR, so use the Currency module for floors in other currencies). Flux creatives are not compatible with SafeFrames. User sync is iframe-only.

The Flux bidding adapter requires setup before use. Please contact us at [bidder@fluxtech.ai](mailto:bidder@fluxtech.ai).

# Bid Params

| Name          | Scope    | Description                                                       | Example         | Type     |
|---------------|----------|-------------------------------------------------------------------|-----------------|----------|
| `publisherId` | required | Publisher ID assigned by Flux                                     | `'11111'`       | `string` |
| `siteDomain`  | optional | Site domain. Only needed if different from the current page domain | `'example.com'` | `string` |
| `placementId` | optional | Placement ID. Only needed if a placement differs from the others   | `'11111'`       | `string` |

# Test Parameters

```javascript
var adUnits = [
  {
    code: 'flux-banner-ad',
    mediaTypes: {
      banner: {
        sizes: [[300, 250]]
      }
    },
    bids: [
      {
        bidder: 'flux',
        params: {
          publisherId: 'test'
        }
      }
    ]
  }
];
```

Add `fluxTest=1` to the page URL to receive a test bid. Test bids carry the ad server targeting key `fluxBidderTest=1`.
