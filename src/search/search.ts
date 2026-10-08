import type { ModuleFactory, SearchInstance, SearchPort } from '../../types/ports';
import { createSearchModel } from './search-model';
import { mountSearch } from './mount-search';
export let YTGamepadSearch: ModuleFactory<SearchPort,SearchInstance> = {
  create: port => createSearchModel(port, mountSearch)
};
