import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemReportStorage } from "./storage.js";

describe("FilesystemReportStorage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sodeja-report-storage-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("saves and reads back a file, creating nested directories as needed", async () => {
    const storage = new FilesystemReportStorage(dir);
    const key = "project-1/report-1.pdf";
    const data = Buffer.from("not really a pdf, just bytes");

    await storage.save(key, data);
    const read = await storage.read(key);

    expect(read).not.toBeNull();
    expect(read?.equals(data)).toBe(true);
  });

  it("returns null, never throws, for a missing key", async () => {
    const storage = new FilesystemReportStorage(dir);
    const read = await storage.read("nothing/here.pdf");
    expect(read).toBeNull();
  });

  it("refuses a key that would escape the base directory", async () => {
    const storage = new FilesystemReportStorage(dir);
    await expect(storage.save("../escape.pdf", Buffer.from("x"))).rejects.toThrow(/outside its base directory/);
  });
});
