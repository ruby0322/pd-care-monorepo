"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

import { PatientGalleryView } from "@/components/patient-gallery";
import {
  fetchPatientGalleryMonth,
  fetchPatientGalleryUploads,
  type GalleryUploadItem,
} from "@/lib/api/upload-history";
import { getPatientSession } from "@/lib/auth/patient-session";

export default function PatientGalleryPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getPatientSession()) {
      router.replace("/onboarding/patient");
    }
  }, [router]);

  const onUploadClick = useCallback(
    (item: GalleryUploadItem) => {
      router.push(`/patient/uploads/${item.upload_id}`);
    },
    [router]
  );

  const onDayClick = useCallback(
    (dateKey: string) => {
      router.push(`/patient/day/${dateKey}`);
    },
    [router]
  );

  return (
    <PatientGalleryView
      fetchUploads={fetchPatientGalleryUploads}
      fetchMonth={fetchPatientGalleryMonth}
      onUploadClick={onUploadClick}
      onDayClick={onDayClick}
    />
  );
}
