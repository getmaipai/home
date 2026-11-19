import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
export type TurnMetrics={t_check?:number;t_transcript?:number;t_turn_model?:number;t_commit?:number;t_llm_first_token?:number;t_first_chunk_text?:number;t_tts_first_byte?:number;t_first_frame_sent?:number;t_first_audio_played?:number;t_duck?:number;t_stop_sent?:number;early_start?:"used"|"discarded"|"off";backchannel?:boolean;duration_ms?:number;commit_reason?:"model"|"timeout";chunks?:number;t_tool_start?:number;t_tool_end?:number;tool_rounds?:number;t_first_audio_after_tool?:number;rtt_ms?:number;underruns?:number;[key:string]:unknown;};
export function safeMetricRecord(value:TurnMetrics):TurnMetrics{return Object.fromEntries(Object.entries(value).filter(([k])=>!/(transcript|reply|text|content)/i.test(k))) as TurnMetrics;}
export function appendMetrics(path:string,value:TurnMetrics){mkdirSync(dirname(path),{recursive:true});appendFileSync(path,JSON.stringify(safeMetricRecord(value))+"\n");}
