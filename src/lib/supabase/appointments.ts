// ============================================================================
// APPOINTMENT MANAGEMENT MODULE
// ============================================================================
// This module handles all appointment-related operations with Supabase
//
// KEY FEATURES:
// - Create appointments between patients and doctors
// - List appointments for doctors and patients
// - Update appointment status (pending → confirmed → completed)
// - Real-time subscription to appointment changes
//
// DATABASE TABLES USED:
// - appointments: Main appointment storage
// - v_doctor_appointments: View with enriched appointment data
//
// IMPORTANT NOTES:
// - Uses therapist_id internally (maps to doctor_id in the frontend)
// - Appointment dates are stored as timestamps
// - Status flow: pending → confirmed → completed → cancelled
// ============================================================================

import {supabase} from "@/integrations/supabase/client";

export type Appointment = {
  id: string;
  patient_id: string;
  doctor_id: string; // we will map from therapist_id
  status: "pending" | "confirmed" | "completed" | "cancelled";
  date: string; // yyyy-mm-dd
  time: string; // HH:MM:SS
  created_at: string;
  updated_at: string;
  // Enriched fields for UI
  patient_name?: string;
  username?: string;
  reason?: string;
  doctor_name?: string;
  specialization?: string;
};

// ============================================================================
// CREATE APPOINTMENT
// ============================================================================
// Creates a new appointment in the database
//
// PARAMETERS:
// @param payload.patient_id - UUID of the patient (from users table)
// @param payload.doctor_id - UUID of the doctor/therapist
// @param payload.date - Appointment date in format: YYYY-MM-DD
// @param payload.time - Appointment time in format: HH:MM:SS
//
// RETURNS: Normalized appointment object with frontend-friendly field names
//
// USAGE EXAMPLE:
// const appointment = await createAppointment({
//   patient_id: "uuid-patient-123",
//   doctor_id: "uuid-doctor-456",
//   date: "2025-10-30",
//   time: "14:00:00"
// });
// ============================================================================
export async function createAppointment(payload: {
  patient_id: string;
  doctor_id: string;
  date: string;
  time: string;
}) {
  // Map to existing columns: therapist_id, appointment_date (timestamp)
  const appointment_date = `${payload.date}T${payload.time}`;
  const {data, error} = await supabase
    .from("appointments")
    .insert([
      {
        patient_id: payload.patient_id,
        therapist_id: payload.doctor_id,
        appointment_date,
        status: "pending",
      },
    ])
    .select("*")
    .single();
  if (error) throw error;
  return normalizeAppointment(data);
}

export async function listDoctorAppointments(doctor_id: string) {
  // Prefer the enriched view if present; falls back to base table
  const {data, error} = await supabase
    .from("v_doctor_appointments")
    .select(
      "id, patient_id, therapist_id, status, appointment_date, appointment_day, appointment_time, created_at, updated_at, display_patient_name, display_username, reason, doctor_name, specialization"
    )
    .eq("therapist_id", doctor_id)
    .order("appointment_date", {ascending: true});
  if (error) throw error;
  return (data ?? []).map(normalizeAppointment);
}

export async function listPatientAppointments(patient_id: string) {
  const {data, error} = await supabase
    .from("appointments")
    .select("*")
    .eq("patient_id", patient_id)
    .order("appointment_date", {ascending: true});
  if (error) throw error;
  return (data ?? []).map(normalizeAppointment);
}

export async function updateAppointmentStatus(
  id: string,
  status: Appointment["status"]
) {
  const {error} = await supabase
    .from("appointments")
    .update({status})
    .eq("id", id);
  if (error) throw error;
}

export function subscribeToDoctorAppointments(
  doctor_id: string,
  onInsert: (row: Appointment) => void
) {
  return supabase
    .channel(`appointments-doctor-${doctor_id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "appointments",
        filter: `therapist_id=eq.${doctor_id}`,
      },
      (payload) => {
        onInsert(normalizeAppointment(payload.new));
      }
    )
    .subscribe();
}

function normalizeAppointment(row: any): Appointment {
  // Prefer server-generated day/time if available; otherwise compute in local time
  const day = row.appointment_day as string | null;
  const t = row.appointment_time as string | null;
  let date = day || "";
  let time = t || "";
  if ((!date || !time) && row.appointment_date) {
    const d = new Date(row.appointment_date);
    // Local date/time strings
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    date = `${y}-${m}-${dd}`;
    time = `${hh}:${mm}:${ss}`;
  }
  return {
    id: String(row.id),
    patient_id: row.patient_id,
    doctor_id: row.therapist_id,
    status: (row.status || "pending") as Appointment["status"],
    date,
    time,
    created_at: row.created_at,
    updated_at: row.updated_at,
    patient_name: row.display_patient_name || row.patient_name || undefined,
    username: row.display_username || row.patient_username || undefined,
    reason: row.reason || row.notes || undefined,
    doctor_name: row.doctor_name || undefined,
    specialization: row.specialization || undefined,
  };
}
