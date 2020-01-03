# Adobe AEM Search as a MicroService
This Typescript module can be used to implement a very fast light weight search for Adobe AEM or ther Content Management Systems like First Spirit, Sitecore or LifeRay.



## Example Implementation for a simple Adobe AEM search
The Abstract Search needs to be implemented by a custom class. This is an example for a simple AEM page search.

```ts
import { AbstractSearchService } from '@teclead/search-module/AbstractSearch.service';
import { AEMTypes, CommonSearchModel, SearchRankModel } from '@teclead/search-module/models';

interface PageSearchModel extends CommonSearchModel {
    path: string;
    name: string;
    content: ContentModel;
}
interface ContentModel {
    productName: string;
    description: string;
}

export class CustomSearchService extends AbstractSearchService {
    public async setUpSearchService() {
        await this.getServerData();
        await super.setUpSearchService();
    }

    public getRawDataElement(child: any): PageSearchModel {
        const content: ContentModel = this.getFilteredContent(child, ['productName', 'description']);
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
            }
        ];
    }

    public getSearchUrl(): string {
        return `http://localhost:4502/bin/company/asset-service.json?path=${path}&type=${AEMTypes.Page}`;
    }
}
```

## Using the CustomSearch
The constructor takes multiple arguments:
- name of the service for logging
- an optional default API path
- an optional express object
- a number in minutes to update the cache

```ts
 new CustomSearchService({ serviceName: 'Custom Search Service', express: { apiPath: '/api/v1/search', app }, cacheTime: 5 })
 ```





