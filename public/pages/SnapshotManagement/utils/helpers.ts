/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import queryString from "query-string";
import { SnapshotsQueryParams, SMPoliciesQueryParams } from "../models/interfaces";
import { DEFAULT_QUERY_PARAMS } from "../utils/constants";

export function getSMPoliciesQueryParamsFromURL(location: { search: string }): SMPoliciesQueryParams {
  const { from, size, sortField, sortOrder, search } = queryString.parse(location.search);
  return <SMPoliciesQueryParams>{
    // @ts-ignore
    from: isNaN(parseInt(from, 10)) ? DEFAULT_QUERY_PARAMS.from : parseInt(from, 10),
    // @ts-ignore
    size: isNaN(parseInt(size, 10)) ? DEFAULT_QUERY_PARAMS.size : parseInt(size, 10),
    search: typeof search !== "string" ? DEFAULT_QUERY_PARAMS.search : search,
    sortField: typeof sortField !== "string" ? "name" : sortField,
    sortOrder: typeof sortOrder !== "string" ? DEFAULT_QUERY_PARAMS.sortOrder : sortOrder,
  };
}
