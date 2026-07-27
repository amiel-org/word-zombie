export type SchoolStageId = "junior" | "senior";

export interface SchoolStageDefinition {
  readonly id: SchoolStageId;
  readonly label: string;
}

interface CourseBase {
  readonly id: string;
  readonly stage: SchoolStageId;
  readonly title: string;
  readonly edition: string | null;
  readonly volume: string | null;
}

export interface AvailableCourse extends CourseBase {
  readonly availability: "available";
  readonly edition: string;
  readonly volume: string;
  readonly availableLevelIds: readonly string[];
  readonly defaultLevelId: string;
  readonly statusMessage: null;
}

export interface UnavailableCourse extends CourseBase {
  readonly availability: "unavailable";
  readonly availableLevelIds: readonly [];
  readonly defaultLevelId: null;
  readonly statusMessage: string;
}

export type CourseCatalogEntry = AvailableCourse | UnavailableCourse;

export const SCHOOL_STAGES = [
  { id: "junior", label: "初中" },
  { id: "senior", label: "高中" },
] as const satisfies readonly SchoolStageDefinition[];

export const COURSE_CATALOG = [
  {
    id: "junior-pending",
    stage: "junior",
    title: "初中英语",
    edition: null,
    volume: null,
    availability: "unavailable",
    availableLevelIds: [],
    defaultLevelId: null,
    statusMessage: "词库待导入",
  },
  {
    id: "senior-diebian-frequency",
    stage: "senior",
    title: "高中英语",
    edition: "蝶变英语词频分类",
    volume: "3,180词",
    availability: "available",
    availableLevelIds: ["frequency-training"],
    defaultLevelId: "frequency-training",
    statusMessage: null,
  },
] as const satisfies readonly CourseCatalogEntry[];

export type CatalogCourse = (typeof COURSE_CATALOG)[number];
export type CatalogCourseId = CatalogCourse["id"];

export const DEFAULT_STAGE_ID = "senior" satisfies SchoolStageId;
export const DEFAULT_COURSE_ID =
  "senior-diebian-frequency" satisfies CatalogCourseId;

export function getCourseById(courseId: string): CatalogCourse | undefined {
  return COURSE_CATALOG.find((course) => course.id === courseId);
}

export function getCoursesByStage(
  stageId: SchoolStageId,
): readonly CatalogCourse[] {
  return COURSE_CATALOG.filter((course) => course.stage === stageId);
}

export function getDefaultCourse(): Extract<
  CatalogCourse,
  { readonly availability: "available" }
> {
  const course = getCourseById(DEFAULT_COURSE_ID);

  if (!course || course.availability !== "available") {
    throw new Error("Default course must be available");
  }

  return course;
}
