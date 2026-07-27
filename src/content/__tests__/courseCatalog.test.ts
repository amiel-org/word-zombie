import { describe, expect, it } from "vitest";

import {
  COURSE_CATALOG,
  DEFAULT_COURSE_ID,
  DEFAULT_STAGE_ID,
  SCHOOL_STAGES,
  getCourseById,
  getCoursesByStage,
  getDefaultCourse,
} from "../courseCatalog";

describe("courseCatalog", () => {
  it("offers junior and senior school entry points", () => {
    expect(SCHOOL_STAGES).toEqual([
      { id: "junior", label: "初中" },
      { id: "senior", label: "高中" },
    ]);
  });

  it("describes the currently available senior frequency course", () => {
    expect(getCourseById("senior-diebian-frequency")).toEqual({
      id: "senior-diebian-frequency",
      stage: "senior",
      title: "高中英语",
      edition: "蝶变英语词频分类",
      volume: "3,180词",
      availability: "available",
      availableLevelIds: ["frequency-training"],
      defaultLevelId: "frequency-training",
      statusMessage: null,
    });
  });

  it("keeps the junior placeholder unavailable without inventing a version", () => {
    expect(getCourseById("junior-pending")).toEqual({
      id: "junior-pending",
      stage: "junior",
      title: "初中英语",
      edition: null,
      volume: null,
      availability: "unavailable",
      availableLevelIds: [],
      defaultLevelId: null,
      statusMessage: "词库待导入",
    });
  });

  it("queries courses by stage and returns an available default", () => {
    expect(getCoursesByStage("junior").map((course) => course.id)).toEqual([
      "junior-pending",
    ]);
    expect(getCoursesByStage("senior").map((course) => course.id)).toEqual([
      "senior-diebian-frequency",
    ]);

    expect(DEFAULT_STAGE_ID).toBe("senior");
    expect(DEFAULT_COURSE_ID).toBe("senior-diebian-frequency");
    expect(getDefaultCourse()).toMatchObject({
      id: DEFAULT_COURSE_ID,
      availability: "available",
    });
  });

  it("uses unique course identifiers", () => {
    const ids = COURSE_CATALOG.map((course) => course.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
