import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  getLegacyProjectComposeRoutePath,
  getProjectArchivedRoutePath,
  getProjectSettingsRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
  isProjectlessProjectId,
  ROOT_COMPOSE_ROUTE_PATH,
} from "./app-route-paths";

describe("app route path helpers", () => {
  it("uses root as the compose route", () => {
    expect(ROOT_COMPOSE_ROUTE_PATH).toBe("/");
    expect(getRootComposeRoutePath()).toBe("/");
  });

  it("builds legacy project compose redirect URLs", () => {
    expect(getLegacyProjectComposeRoutePath("proj_standard")).toBe(
      "/projects/proj_standard",
    );
  });

  it("builds project utility URLs", () => {
    expect(getProjectSettingsRoutePath("proj_standard")).toBe(
      "/projects/proj_standard/settings",
    );
    expect(getProjectArchivedRoutePath("proj_standard")).toBe(
      "/projects/proj_standard/archived",
    );
  });

  it("builds canonical projectless thread detail URLs", () => {
    expect(
      getThreadRoutePath({
        projectId: PERSONAL_PROJECT_ID,
        threadId: "thr_personal",
      }),
    ).toBe("/threads/thr_personal");
  });

  it("keeps standard project thread detail URLs project scoped", () => {
    expect(
      getThreadRoutePath({
        projectId: "proj_standard",
        threadId: "thr_standard",
      }),
    ).toBe("/projects/proj_standard/threads/thr_standard");
  });

  it("recognizes only the personal project id as projectless", () => {
    expect(isProjectlessProjectId(PERSONAL_PROJECT_ID)).toBe(true);
    expect(isProjectlessProjectId("proj_standard")).toBe(false);
    expect(isProjectlessProjectId(undefined)).toBe(false);
  });
});
