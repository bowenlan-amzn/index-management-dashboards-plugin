/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import _ from "lodash";
import {
  ILegacyCustomClusterClient,
  IOpenSearchDashboardsResponse,
  OpenSearchDashboardsRequest,
  OpenSearchDashboardsResponseFactory,
  RequestHandlerContext,
  ResponseError,
} from "../../../../src/core/server";
import { SMPolicy, DocumentSMPolicy } from "../../models/interfaces";
import {
  CatRepository,
  CatSnapshotWithRepoAndPolicy,
  GetSnapshotsResponse,
  GetSMPoliciesResponse,
  DeletePolicyResponse,
  GetSnapshot,
  GetSnapshotResponse,
  GetRepositoryResponse,
  AcknowledgedResponse,
} from "../models/interfaces";
import { FailedServerResponse, ServerResponse } from "../models/types";

export default class SnapshotManagementService {
  osDriver: ILegacyCustomClusterClient;

  constructor(osDriver: ILegacyCustomClusterClient) {
    this.osDriver = osDriver;
  }

  getSnapshotsWithPolicy = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<GetSnapshotsResponse>>> => {
    try {
      // if no repository input, we need to first get back all repositories
      const getRepositoryRes = await this.catRepositories(context, request, response);
      let repositories: string[];
      if (getRepositoryRes.payload?.ok) {
        repositories = getRepositoryRes.payload?.response.map((repo) => repo.id);
        console.log(`sm dev get repositories ${JSON.stringify(repositories)}`);
      } else {
        return response.custom({
          statusCode: 200,
          body: {
            ok: false,
            error: getRepositoryRes.payload?.error as string,
          },
        });
      }

      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      let snapshots: CatSnapshotWithRepoAndPolicy[] = [];
      for (let i = 0; i < repositories.length; i++) {
        const res: GetSnapshotResponse = await callWithRequest("snapshot.get", {
          repository: repositories[i],
          snapshot: "_all",
          ignore_unavailable: true,
        });
        const snapshotWithPolicy: CatSnapshotWithRepoAndPolicy[] = res.snapshots.map((s: GetSnapshot) => ({
          id: s.snapshot,
          status: s.state,
          start_epoch: s.start_time_in_millis,
          end_epoch: s.end_time_in_millis,
          duration: s.duration_in_millis,
          indices: s.indices.length,
          successful_shards: s.shards.successful,
          failed_shards: s.shards.failed,
          total_shards: s.shards.total,
          repository: repositories[i],
          policy: s.metadata.sm_policy,
        }));
        // TODO SM try catch the missing snapshot exception
        // const catSnapshotsRes: CatSnapshotWithRepoAndPolicy[] = await callWithRequest("snapshot.get", params);
        // const snapshotsWithRepo = catSnapshotsRes.map((item) => ({ ...item, repository: repositories[i] }));
        // console.log(`sm dev cat snapshot response: ${JSON.stringify(snapshotWithPolicy)}`);
        snapshots = [...snapshots, ...snapshotWithPolicy];
      }

      // populate policy field for snapshot
      // const getSMPoliciesRes = await this.getPolicies(context, request, response);
      // if (getSMPoliciesRes.payload?.ok) {
      //   const policyNames = getSMPoliciesRes.payload?.response.policies
      //     .map((policy) => policy.policy.name)
      //     .sort((a, b) => b.length - a.length);
      //   console.log(`sm dev get snapshot policies ${policyNames}`);
      //   function addPolicyField(snapshot: CatSnapshotWithRepoAndPolicy) {
      //     for (let i = 0; i < policyNames.length; i++) {
      //       if (snapshot.id.startsWith(policyNames[i])) {
      //         return { ...snapshot, policy: policyNames[i] };
      //       }
      //     }
      //     return snapshot;
      //   }
      //   snapshots = snapshots.map(addPolicyField);
      // }

      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: {
            snapshots: snapshots,
            totalSnapshots: snapshots.length,
          },
        },
      });
    } catch (err) {
      // TODO SM handle missing snapshot exception, return empty
      return this.errorResponse(response, err, "catSnapshots");
    }
  };

  getSnapshot = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<GetSnapshot>>> => {
    try {
      const { id } = request.params as {
        id: string;
      };
      const { repository } = request.query as {
        repository: string;
      };
      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      const res: GetSnapshotResponse = await callWithRequest("snapshot.get", {
        repository: repository,
        snapshot: `${id}`,
        ignore_unavailable: true,
      });

      console.log(`sm dev get snapshot response: ${JSON.stringify(res)}`);
      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: res.snapshots[0],
        },
      });
    } catch (err) {
      return this.errorResponse(response, err, "getSnapshot");
    }
  };

  createPolicy = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<DocumentSMPolicy>>> => {
    try {
      const { id } = request.params as { id: string };
      const params = {
        policyId: id,
        body: JSON.stringify(request.body),
      };

      console.log(`sm dev create policy ${JSON.stringify(request.body)}`);

      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      const rawRes = await callWithRequest("ism.createSMPolicy", params);
      const res: DocumentSMPolicy = {
        seqNo: rawRes._seq_no,
        primaryTerm: rawRes._primary_term,
        id: rawRes._id,
        policy: rawRes.sm_policy,
      };

      console.log(`sm dev server create policy response: ${JSON.stringify(res)}`);

      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: res,
        },
      });
    } catch (err) {
      return this.errorResponse(response, err, "createPolicy");
    }
  };

  updatePolicy = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<DocumentSMPolicy>>> => {
    try {
      const { id } = request.params as { id: string };
      const { seqNo, primaryTerm } = request.query as { seqNo?: string; primaryTerm?: string };
      const params = {
        policyId: id,
        ifSeqNo: seqNo,
        ifPrimaryTerm: primaryTerm,
        body: JSON.stringify(request.body),
      };

      console.log(`sm dev update policy ${JSON.stringify(request.body)}`);

      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      const rawRes = await callWithRequest("ism.updateSMPolicy", params);
      const res: DocumentSMPolicy = {
        seqNo: rawRes._seq_no,
        primaryTerm: rawRes._primary_term,
        id: rawRes._id,
        policy: rawRes.sm_policy,
      };
      console.log(`sm dev server update policy response: ${JSON.stringify(res)}`);

      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: res,
        },
      });
    } catch (err) {
      return this.errorResponse(response, err, "updatePolicy");
    }
  };

  getPolicies = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<GetSMPoliciesResponse>>> => {
    try {
      const { from, size, sortField, sortOrder, queryString } = request.query as {
        from: string;
        size: string;
        sortField: string;
        sortOrder: string;
        queryString: string;
      };

      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      let params = {
        from,
        size,
        sortField: `sm_policy.${sortField}`,
        sortOrder,
        queryString: queryString.trim() ? `${queryString.trim()}` : "*",
      };
      console.log(`sm dev get policies ${JSON.stringify(params)}`);
      const res = await callWithRequest("ism.getSMPolicies", params);

      const policies: DocumentSMPolicy[] = res.policies.map(
        (p: { _id: string; _seq_no: number; _primary_term: number; sm_policy: SMPolicy }) => ({
          seqNo: p._seq_no,
          primaryTerm: p._primary_term,
          id: p._id,
          policy: p.sm_policy,
        })
      );
      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: { policies, totalPolicies: res.total_policies as number },
        },
      });
      // TODO SM handle config index not exist
    } catch (err) {
      return this.errorResponse(response, err, "getPolicies");
    }
  };

  getPolicy = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<DocumentSMPolicy>>> => {
    try {
      const { id } = request.params as { id: string };
      const params = { policyId: id };
      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      const getResponse = await callWithRequest("ism.getSMPolicy", params);
      const documentPolicy = {
        id: id,
        seqNo: getResponse._seq_no,
        primaryTerm: getResponse._primary_term,
        policy: getResponse.sm_policy,
      };
      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: documentPolicy,
        },
      });
    } catch (err) {
      return this.errorResponse(response, err, "getPolicy");
    }
  };

  deletePolicy = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<boolean>>> => {
    try {
      const { id } = request.params as { id: string };
      const params = { policyId: id };
      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      const deletePolicyResponse: DeletePolicyResponse = await callWithRequest("ism.deleteSMPolicy", params);
      if (deletePolicyResponse.result !== "deleted") {
        return response.custom({
          statusCode: 200,
          body: {
            ok: false,
            error: deletePolicyResponse.result,
          },
        });
      }
      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: true,
        },
      });
    } catch (err) {
      return this.errorResponse(response, err, "deletePolicy");
    }
  };

  catRepositories = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<CatRepository[]>>> => {
    try {
      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      const res: CatRepository[] = await callWithRequest("cat.repositories", {
        format: "json",
      });
      console.log(`sm dev cat repositories response: ${JSON.stringify(res)}`);
      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: res,
        },
      });
    } catch (err) {
      return this.errorResponse(response, err, "getRepositories");
    }
  };

  // delete repository
  deleteRepository = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<AcknowledgedResponse>>> => {
    try {
      const { id } = request.params as { id: string };
      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      const res: AcknowledgedResponse = await callWithRequest("snapshot.deleteRepository", {
        repository: id,
      });
      console.log(`sm dev delete repository response: ${JSON.stringify(res)}`);
      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: res,
        },
      });
    } catch (err) {
      return this.errorResponse(response, err, "deleteRepository");
    }
  };

  // get repository for edit
  getRepository = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<GetRepositoryResponse>>> => {
    try {
      const { id } = request.params as { id: string };
      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      const res: GetRepositoryResponse = await callWithRequest("snapshot.getRepository", {
        repository: id,
      });
      console.log(`sm dev get repository response: ${JSON.stringify(res)}`);
      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: res,
        },
      });
    } catch (err) {
      return this.errorResponse(response, err, "getRepository");
    }
  };

  // create repository
  createRepository = async (
    context: RequestHandlerContext,
    request: OpenSearchDashboardsRequest,
    response: OpenSearchDashboardsResponseFactory
  ): Promise<IOpenSearchDashboardsResponse<ServerResponse<AcknowledgedResponse>>> => {
    try {
      const { id } = request.params as { id: string };
      const params = {
        repository: id,
        body: JSON.stringify(request.body),
      };
      console.log(`sm dev create repo params ${JSON.stringify(params)}`);
      const { callAsCurrentUser: callWithRequest } = this.osDriver.asScoped(request);
      const res: AcknowledgedResponse = await callWithRequest("snapshot.createRepository", params);
      console.log(`sm dev create repository response: ${JSON.stringify(res)}`);
      return response.custom({
        statusCode: 200,
        body: {
          ok: true,
          response: res,
        },
      });
    } catch (err) {
      return this.errorResponse(response, err, "createRepository");
    }
  };

  errorResponse = (
    response: OpenSearchDashboardsResponseFactory,
    error: any,
    methodName: string
  ): IOpenSearchDashboardsResponse<FailedServerResponse> => {
    console.error(`Index Management - SnapshotManagementService - ${methodName}:`, error);

    return response.custom({
      statusCode: 200, // error?.statusCode || 500,
      body: {
        ok: false,
        error: this.parseEsErrorResponse(error),
      },
    });
  };

  parseEsErrorResponse = (error: any): string => {
    if (error.response) {
      try {
        const esErrorResponse = JSON.parse(error.response);
        return esErrorResponse.reason || error.response;
      } catch (parsingError) {
        return error.response;
      }
    }
    return error.message;
  };
}
