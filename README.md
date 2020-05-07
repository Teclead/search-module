# Adobe AEM Search as a MicroService

This Typescript module can be used to implement a very fast light weight search for Adobe AEM or ther Content Management Systems like First Spirit, Sitecore or LifeRay.

## Example Implementation for a simple Adobe AEM search

The Abstract Search needs to be implemented by a custom class. This is an example for a simple AEM page search.

```ts
import { AbstractSearchService } from "@teclead/search-module/AbstractSearch.service";
import {
  AEMTypes,
  CommonSearchModel,
  SearchRankModel,
} from "@teclead/search-module/models";

interface PageSearchModel extends CommonSearchModel {
  path: string;
  name: string;
  content: ContentModel;
}
interface ContentModel {
  productName: string;
  description: string;
}
const pageContentKeys: PageContentKeys[] = [
  { key: "productName" },
  { key: "description", manipulation: cleanUp },
];
// to clean up unwanted data, method will be executed if injected
const cleanUp = (value: string): string => {
  return value.replace("I dont want this", "I love it");
};

export class CustomSearchService extends AbstractSearchService {
  // for multiple instances a delay can be created if instanceNumber > 0 => instanceNumber * instanceDelay = delayTime
  instanceNumber = 0;
  //delay time in minutes
  instanceDelay = 1;
  //enableCacheTrigger allows you to manually trigger cache if set to true under ${apiPath}/updateCache
  enableCacheTrigger = false;

  async setUpCallbacksBefore() {
    await this.getServerData();
  }

  async setUpCallbacksAfter() {}

  public getRawDataElement(child: any): PageSearchModel {
    const content: ContentModel = this.getFilteredContent(
      child,
      pageContentKeys
    );
    const transformed = { ...child };
    return { path: transformed.path, name: transformed.name, content };
  }

  public getSearchCriteria(searchModel: PageSearchModel): SearchRankModel[] {
    return [
      {
        searchElement: searchModel.name,
        rank: 3,
      },
      {
        searchElement: searchModel.content.productName,
        rank: 2,
      },
      {
        searchElement: searchModel.content.description,
        rank: 1,
      },
    ];
  }

  // multiple servers can be configured here in order to have loadbalancing in place
  public getSearchUrl(): string[] | string {
    let aemServerUrls: string[] = [
      "http://localhost:4502",
      "http://localhost:4502",
    ];
    const path = "/content/ergo/ergo-one/ergo-one-portal";
    aemServerUrls = aemServerUrls.map(
      (url: string) =>
        `${url}/bin/company/asset-service.json?path=${path}&type=${AEMTypes.Page}`
    );
    return aemServerUrls;
  }

  // for security purposes headers can be injected into the fetch request
  public getSearchUrlRequestInits(): RequestInit {
    const headers = new Headers();
    headers.append("Authkey", `${btoa(envVar.authKey)}`);
    return {
      method: "GET",
      headers: headers,
    };
  }
}
```

## Using the CustomSearch

The constructor takes multiple arguments:

- name of the service for logging
- an optional default API path
- an optional express object
- a number in minutes to update the cache

API's
```
- ${apiPath}?search=**searchWord** => returns search results
- ${apiPath}/updateCache => trigger cache manually if enableCacheTrigger is true
- ${apiPath}/synonyms?word=**searchSynonym** => get an array of arrays of synonyms for the word you are looking for
```
```ts
new CustomSearchService({
  serviceName: "Custom Search Service",
  express: { apiPath: "/api/v1/search", app },
  cacheTime: 5,
});
```

## Response

An example response from the implemented custom Search with Adobe AEM Pages for the term `auto`.

```json
// 20200103180457
// http://localhost:8082/api/v1/brandname-pages?search=auto
{
    "search": "auto,automobil,fahrbarer untersatz,pkw,personenwagen,personenkraftwagen,motorwagen,blechbüchse,wagen",
    "foundItems": 21,
    "results": [
        {
            "path": "/content/brandname/de/Produkte/KFZ-Versicherung/Autoversicherung",
            "name": "Autoversicherung from Brandname",
            "content": {
               "productName": "Autoversicherung",
               "description": "This is the page description."
            },
            "searchRank": 3
        },
        {...}
    ]
}
```
