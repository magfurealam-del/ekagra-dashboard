'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {withRetry} from '@/lib/withTimeout'

export type BookingDoctor = {name:string;aliases:string[];has_schedule:boolean;has_configured_schedule:boolean}
export type BookingDay = {date:string;slots:string[];appointment_count:number;unavailable:boolean}
export type BookingContext = {doctor_name:string|null;status:'ready'|'unknown_doctor'|'schedule_missing'|'schedule_paused';days:BookingDay[]}
export const slotLabel=(value:string)=>{const [h,m]=value.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'pm':'am'}`}

export function useBookingDoctors(includeUnavailable=false) {
 const [doctors,setDoctors]=useState<BookingDoctor[]>([])
 const [error,setError]=useState('')
 useEffect(()=>{
  let cancelled=false
  const load=()=>withRetry(()=>supabase.rpc('get_doctor_booking_directory'),12000,2).then(({data,error})=>{
   if(cancelled)return
   if(error){setError('Doctor list could not be loaded. Refresh reference data to retry.');return}
   setDoctors(data||[]);setError('')
  }).catch(()=>{if(!cancelled)setError('Doctor list could not be loaded. Refresh reference data to retry.')})
  load();window.addEventListener('ekagra:refresh-reference-data',load)
  return()=>{cancelled=true;window.removeEventListener('ekagra:refresh-reference-data',load)}
 },[])
 return {doctors,options:doctors.filter(d=>includeUnavailable||d.has_schedule).map(d=>({label:d.name,value:d.name})),error}
}

export function useDoctorBooking(doctor:string,start:string,end=start) {
 const key=[doctor,start,end].join('|')
 const [state,setState]=useState<{key:string;data:BookingContext|null;error:string}>({key:'',data:null,error:''})
 const [revision,setRevision]=useState(0)
 const refresh=()=>setRevision(n=>n+1)
 useEffect(()=>{
  const refreshOnFocus=()=>setRevision(n=>n+1)
  window.addEventListener('focus',refreshOnFocus)
  window.addEventListener('ekagra:refresh-reference-data',refreshOnFocus)
  return()=>{window.removeEventListener('focus',refreshOnFocus);window.removeEventListener('ekagra:refresh-reference-data',refreshOnFocus)}
 },[])
 useEffect(()=>{
  if(!doctor||!start)return
  let cancelled=false
  setState({key,data:null,error:''})
  withRetry(()=>supabase.rpc('get_doctor_booking_context',{p_doctor_name:doctor,p_start_date:start,p_end_date:end}),12000,2).then(({data,error})=>{
   if(!cancelled)setState({key,data:error?null:data,error:error?'Availability could not be loaded. Retry before booking.':''})
  }).catch(()=>{if(!cancelled)setState({key,data:null,error:'Availability could not be loaded. Retry before booking.'})})
  return()=>{cancelled=true}
 },[doctor,start,end,key,revision])
 const current=state.key===key?state:null
 const data=current?.data||null, error=current?.error||''
 const day=data?.days.find(d=>d.date===start)
 const loading=!!doctor&&!!start&&!data&&!error
 const note=error||(!doctor?'Select a doctor first.':loading?'Loading availability…':data?.status==='unknown_doctor'?'This record has no recognized active doctor. Ask an administrator to resolve the doctor name.':data?.status==='schedule_missing'?'No weekly schedule is configured. Ask an administrator to add approved hours in Settings.':data?.status==='schedule_paused'?'All weekly sessions are off. This doctor is unavailable for booking.':day?.unavailable?'Doctor marked unavailable on this date.':day&&!day.slots.length?'No appointment slots on this date. Choose another available day.':'')
 return {data,slots:day?.slots||[],count:day?.appointment_count??null,loading,error,note,refresh}
}
