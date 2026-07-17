import {
  computeGrayMad,
  createStabilityTracker,
  GUIDANCE_COPY,
  isShutterEnabled,
  mapPrescreenToPresence,
  nextStabilityState,
  resolveGuidanceStatus,
  type PresenceGuidanceStatus,
} from "@/lib/camera-stability";

function grayOf(value: number, length = 4): Uint8ClampedArray {
  return Uint8ClampedArray.from({ length }, () => value);
}

describe("computeGrayMad", () => {
  it("returns 0 for identical buffers", () => {
    const a = grayOf(10, 8);
    expect(computeGrayMad(a, a)).toBe(0);
  });

  it("returns mean absolute difference", () => {
    const a = Uint8ClampedArray.from([0, 0, 0, 0]);
    const b = Uint8ClampedArray.from([10, 0, 10, 0]);
    expect(computeGrayMad(a, b)).toBe(5);
  });
});

describe("nextStabilityState", () => {
  it("stays unstable until enough calm samples", () => {
    let tracker = createStabilityTracker();
    tracker = nextStabilityState(tracker, grayOf(20), {
      madThreshold: 5,
      requiredStableSamples: 3,
    });
    expect(tracker.isStable).toBe(false);

    tracker = nextStabilityState(tracker, grayOf(21), {
      madThreshold: 5,
      requiredStableSamples: 3,
    });
    expect(tracker.consecutiveStable).toBe(1);
    expect(tracker.isStable).toBe(false);

    tracker = nextStabilityState(tracker, grayOf(22), {
      madThreshold: 5,
      requiredStableSamples: 3,
    });
    expect(tracker.consecutiveStable).toBe(2);
    expect(tracker.isStable).toBe(false);

    tracker = nextStabilityState(tracker, grayOf(23), {
      madThreshold: 5,
      requiredStableSamples: 3,
    });
    expect(tracker.consecutiveStable).toBe(3);
    expect(tracker.isStable).toBe(true);
  });

  it("resets immediately when MAD exceeds threshold", () => {
    let tracker = createStabilityTracker();
    tracker = nextStabilityState(tracker, grayOf(20), {
      madThreshold: 5,
      requiredStableSamples: 2,
    });
    tracker = nextStabilityState(tracker, grayOf(21), {
      madThreshold: 5,
      requiredStableSamples: 2,
    });
    tracker = nextStabilityState(tracker, grayOf(22), {
      madThreshold: 5,
      requiredStableSamples: 2,
    });
    expect(tracker.isStable).toBe(true);

    tracker = nextStabilityState(tracker, grayOf(40), {
      madThreshold: 5,
      requiredStableSamples: 2,
    });
    expect(tracker.isStable).toBe(false);
    expect(tracker.consecutiveStable).toBe(0);
  });
});

describe("guidance status mapping", () => {
  const cases: Array<{
    stable: boolean;
    presence: ReturnType<typeof mapPrescreenToPresence>;
    expected: PresenceGuidanceStatus;
    shutter: boolean;
  }> = [
    { stable: false, presence: "ok", expected: "shaky", shutter: false },
    { stable: true, presence: "idle", expected: "idle", shutter: false },
    { stable: true, presence: "ok", expected: "ok", shutter: true },
    { stable: true, presence: "realign", expected: "realign", shutter: false },
    { stable: true, presence: "unavailable", expected: "unavailable", shutter: true },
  ];

  it.each(cases)(
    "stable=$stable presence=$presence → $expected (shutter=$shutter)",
    ({ stable, presence, expected, shutter }) => {
      const status = resolveGuidanceStatus(stable, presence);
      expect(status).toBe(expected);
      expect(isShutterEnabled(status)).toBe(shutter);
    }
  );

  it("maps prescreen responses", () => {
    expect(mapPrescreenToPresence({ present: true, checked: true }, false)).toBe("ok");
    expect(mapPrescreenToPresence({ present: false, checked: true }, false)).toBe("realign");
    expect(mapPrescreenToPresence({ present: true, checked: false }, false)).toBe("unavailable");
    expect(mapPrescreenToPresence(null, true)).toBe("unavailable");
  });

  it("uses patient-readable copy that mentions exit site when realigning", () => {
    expect(GUIDANCE_COPY.realign).toContain("出口部位");
    expect(GUIDANCE_COPY.ok).toContain("可以按下快門");
    expect(GUIDANCE_COPY.shaky).toContain("握穩");
  });
});
