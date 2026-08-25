"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { PatientGalleryView } from "@/components/patient-gallery";
import { fetchPatientProfile } from "@/lib/api/identity";
import { fetchStaffPatientGalleryMonth, fetchStaffPatientGalleryUploads } from "@/lib/api/staff";
import {
  fetchPatientGalleryMonth,
  fetchPatientGalleryUploads,
  type GalleryUploadItem,
} from "@/lib/api/upload-history";
import { getPatientSession } from "@/lib/auth/patient-session";
import { getStaffSession } from "@/lib/auth/staff-session";

export default function PatientGalleryByIdPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const patientId = Number(params.id);
  const [viewer, setViewer] = useState<"patient" | "staff" | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function resolveViewer() {
      if (Number.isNaN(patientId)) {
        router.replace("/patient/gallery");
        return;
      }
      const staffSession = getStaffSession();
      const patientSession = getPatientSession();
      if (!staffSession && !patientSession) {
        router.replace("/onboarding/patient");
        return;
      }
      if (patientSession) {
        try {
          const profile = await fetchPatientProfile();
          if (cancelled) {
            return;
          }
          if (profile.patient_id === patientId) {
            setViewer("patient");
            return;
          }
        } catch {
          if (cancelled) {
            return;
          }
        }
        if (!staffSession) {
          router.replace("/patient/gallery");
          return;
        }
      }
      if (staffSession) {
        if (!patientSession) {
          await Promise.resolve();
        }
        if (!cancelled) {
          setViewer("staff");
        }
        return;
      }
      router.replace("/patient/gallery");
    }
    void resolveViewer();
    return () => {
      cancelled = true;
    };
  }, [patientId, router]);

  const fetchStaffUploads = useCallback(
    (params?: { beforeId?: number; limit?: number }) => fetchStaffPatientGalleryUploads(patientId, params),
    [patientId]
  );
  const fetchStaffMonth = useCallback(
    (month: string) => fetchStaffPatientGalleryMonth(patientId, month),
    [patientId]
  );

  const onPatientUploadClick = useCallback(
    (item: GalleryUploadItem) => {
      router.push(`/patient/uploads/${item.upload_id}`);
    },
    [router]
  );
  const onPatientDayClick = useCallback(
    (dateKey: string) => {
      router.push(`/patient/day/${dateKey}`);
    },
    [router]
  );
  const onStaffUploadClick = useCallback(
    (item: GalleryUploadItem) => {
      router.push(`/admin/patients/${patientId}?date=${encodeURIComponent(item.date)}`);
    },
    [patientId, router]
  );
  const onStaffDayClick = useCallback(
    (dateKey: string) => {
      router.push(`/admin/patients/${patientId}?date=${encodeURIComponent(dateKey)}`);
    },
    [patientId, router]
  );

  if (viewer === null) {
    return <div className="px-6 pt-10 text-sm text-zinc-500">載入中...</div>;
  }

  if (viewer === "staff") {
    return (
      <PatientGalleryView
        fetchUploads={fetchStaffUploads}
        fetchMonth={fetchStaffMonth}
        onUploadClick={onStaffUploadClick}
        onDayClick={onStaffDayClick}
      />
    );
  }

  return (
    <PatientGalleryView
      fetchUploads={fetchPatientGalleryUploads}
      fetchMonth={fetchPatientGalleryMonth}
      onUploadClick={onPatientUploadClick}
      onDayClick={onPatientDayClick}
    />
  );
}
