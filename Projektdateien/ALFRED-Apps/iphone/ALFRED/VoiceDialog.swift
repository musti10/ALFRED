import SwiftUI
import AVFoundation

struct VoiceReady:Decodable {let ready:Bool;let message:String?}
struct Transcript:Decodable {let text:String}

// Mirrors the browser detector; continuous onset prevents scattered noise spikes
// from accumulating into a voice turn. This remains energy-based, not semantic VAD.
struct SpeechTurnDetector {
 enum Decision {case waiting, complete, noSpeech}
 private(set) var elapsed=0.0
 private var onset=0.0
 private var quiet=0.0
 private var heard=false
 mutating func update(level:Double,dt:Double)->Decision {
  elapsed+=dt
  if level > -38 {onset+=min(dt,0.15);quiet=0;if onset+1e-9>=0.3{heard=true}}
  else{onset=0;quiet+=dt}
  if !heard && elapsed>=20-1e-9{return .noSpeech}
  if heard && (quiet>=2-1e-9 || elapsed>=45-1e-9){return .complete}
  return .waiting
 }
}

@MainActor final class VoiceDialog:NSObject,ObservableObject,AVAudioPlayerDelegate {
 @Published var active=false
 @Published var status="Bereit für Ihre Frage."
 @Published var failure:String?
 @Published var heard=""
 private let alfred:Alfred
 private var recorder:AVAudioRecorder?
 private var player:AVAudioPlayer?
 private var recordingURL:URL?
 private var meter:Timer?
 private var work:Task<Void,Never>?
 private var epoch=0
 private var measured=Date()
 private var turn=SpeechTurnDetector()
 init(alfred:Alfred){self.alfred=alfred;super.init()}
 func stop(){epoch+=1;active=false;meter?.invalidate();meter=nil;recorder?.stop();recorder=nil;player?.stop();player=nil;work?.cancel();work=nil;removeRecording();try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation);status="Unterhaltung beendet. Mikrofon aus."}
 private func removeRecording(){if let url=recordingURL{try? FileManager.default.removeItem(at:url)};recordingURL=nil}
 func start(){
  guard !active,alfred.api != nil else{return}
  failure=nil;active=true;epoch+=1;let run=epoch;status="Verbindung wird geprüft …"
  work=Task{do{
   guard let api=alfred.api else{throw AppError.message("Bitte zuerst mit dem Mac koppeln.")}
   let input:VoiceReady=try await api.call("/api/voice/status")
   let output:VoiceReady=try await api.call("/api/voice/output/status")
   guard input.ready,output.ready else{throw AppError.message(output.message ?? input.message ?? "Sprache auf dem Mac nicht bereit.")}
   let granted=await withCheckedContinuation{continuation in AVAudioApplication.requestRecordPermission{continuation.resume(returning:$0)}}
   guard active,epoch==run else{return}
   guard granted else{throw AppError.message("Bitte Mikrofonzugriff in den iPhone-Einstellungen erlauben.")}
   try listen(run)
  }catch{fail(error,run)}}
 }
 private func fail(_ error:Error,_ run:Int){guard epoch==run,active else{return};stop();failure=error.localizedDescription}
 private func listen(_ run:Int)throws {
  guard active,epoch==run else{return}
  let session=AVAudioSession.sharedInstance();try session.setCategory(.playAndRecord,mode:.voiceChat,options:[.defaultToSpeaker,.allowBluetoothHFP]);try session.setActive(true)
  let url=FileManager.default.temporaryDirectory.appendingPathComponent("alfred-voice-\(UUID().uuidString).caf");recordingURL=url
  let audio=try AVAudioRecorder(url:url,settings:[AVFormatIDKey:kAudioFormatLinearPCM,AVSampleRateKey:16000,AVNumberOfChannelsKey:1,AVLinearPCMBitDepthKey:16,AVLinearPCMIsFloatKey:false,AVLinearPCMIsBigEndianKey:false])
  audio.isMeteringEnabled=true;guard audio.record() else{throw AppError.message("Mikrofon konnte nicht gestartet werden.")};recorder=audio;measured=Date();turn=SpeechTurnDetector();status="Ich höre zu …"
  meter=Timer.scheduledTimer(withTimeInterval:0.1,repeats:true){[weak self] _ in Task{@MainActor in self?.measure(run)}}
 }
 private func measure(_ run:Int){
  guard active,epoch==run,let recorder else{return}
  recorder.updateMeters();let now=Date()
  let dt=max(0,now.timeIntervalSince(measured));measured=now
  switch turn.update(level:Double(recorder.averagePower(forChannel:0)),dt:dt){
  case .complete:finishRecording(run)
  case .noSpeech:stop();failure="Keine Sprache erkannt. Starten Sie das Gespräch erneut."
  case .waiting:break
  }
 }
 // The Mac accepts canonical mono PCM16 WAV only. CAF metadata never crosses the network.
 private func wav(_ url:URL)throws->Data {
  let file=try AVAudioFile(forReading:url)
  guard file.processingFormat.sampleRate==16000,file.processingFormat.channelCount==1,file.length>=4000,file.length<=960000,let buffer=AVAudioPCMBuffer(pcmFormat:file.processingFormat,frameCapacity:AVAudioFrameCount(file.length)) else{throw AppError.message("Ungültige Aufnahme.")}
  try file.read(into:buffer)
  guard let samples=buffer.floatChannelData?[0] else{throw AppError.message("Audioformat nicht verfügbar.")}
  var pcm=Data();pcm.reserveCapacity(Int(buffer.frameLength)*2)
  for i in 0..<Int(buffer.frameLength){var value=Int16(max(-32768,min(32767,Int(samples[i]*32767)))).littleEndian;withUnsafeBytes(of:&value){pcm.append(contentsOf:$0)}}
  var result=Data();func text(_ s:String){result.append(contentsOf:s.utf8)};func u32(_ n:UInt32){var v=n.littleEndian;withUnsafeBytes(of:&v){result.append(contentsOf:$0)}};func u16(_ n:UInt16){var v=n.littleEndian;withUnsafeBytes(of:&v){result.append(contentsOf:$0)}}
  text("RIFF");u32(UInt32(pcm.count+36));text("WAVEfmt ");u32(16);u16(1);u16(1);u32(16000);u32(32000);u16(2);u16(16);text("data");u32(UInt32(pcm.count));result.append(pcm);return result
 }
 private func finishRecording(_ run:Int){
  guard active,epoch==run,let url=recordingURL else{return}
  meter?.invalidate();meter=nil;recorder?.stop();recorder=nil
  // Microphone is deactivated while the Mac transcribes, thinks and speaks.
  try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation)
  status="Sprache wird auf dem Mac erkannt …"
  work=Task{do{
   let audio=try wav(url);removeRecording();guard let api=alfred.api else{throw AppError.message("Verbindung beendet.")}
   let raw=try await api.binary("/api/voice/transcribe",body:audio,type:"audio/wav");try Task.checkCancellation()
   let transcript=try JSONDecoder().decode(Transcript.self,from:raw).text.trimmingCharacters(in:.whitespacesAndNewlines)
   guard !transcript.isEmpty,transcript.count<=4000 else{throw AppError.message("Keine verständliche Frage erkannt.")}
   guard active,epoch==run else{return};heard=transcript;status="ALFRED denkt …"
   if alfred.selected==nil{let chat:Ack=try await api.call("/api/chats",method:"POST",body:[:]);alfred.selected=chat.id}
   try Task.checkCancellation();guard let id=alfred.selected else{throw AppError.message("Gespräch fehlt.")}
   let _:Ack=try await api.call("/api/chats/\(id)/messages",method:"POST",body:["content":transcript,"engine":"pipecat"])
   try Task.checkCancellation();await alfred.refresh();try Task.checkCancellation()
   guard active,epoch==run,let answer=alfred.messages.last,answer.role=="assistant" else{throw AppError.message("Antwort nicht verfügbar.")}
   status="ALFRED antwortet …"
   let body=try JSONSerialization.data(withJSONObject:["text":answer.content,"confirmed":true])
   let output=try await api.binary("/api/voice/synthesize",body:body,type:"application/json");try Task.checkCancellation()
   guard active,epoch==run else{return}
   let session=AVAudioSession.sharedInstance();try session.setCategory(.playback,mode:.spokenAudio);try session.setActive(true)
   let playback=try AVAudioPlayer(data:output);playback.delegate=self;player=playback;guard playback.play() else{throw AppError.message("Ausgabe konnte nicht gestartet werden.")}
  }catch{fail(error,run)}}
 }
 nonisolated func audioPlayerDidFinishPlaying(_ player:AVAudioPlayer,successfully flag:Bool){Task{@MainActor [weak self] in guard let self,self.active,self.player===player else{return};self.player=nil;do{guard flag else{throw AppError.message("Sprachausgabe unterbrochen.")};try self.listen(self.epoch)}catch{self.fail(error,self.epoch)}}}
 nonisolated func audioPlayerDecodeErrorDidOccur(_ player:AVAudioPlayer,error:Error?){Task{@MainActor [weak self] in guard let self,self.player===player else{return};self.fail(error ?? AppError.message("Sprachausgabe fehlgeschlagen."),self.epoch)}}
}

struct VoiceDialogView:View {
 @StateObject private var dialog:VoiceDialog
 @Environment(\.dismiss) private var dismiss
 @Environment(\.scenePhase) private var phase
 init(alfred:Alfred){_dialog=StateObject(wrappedValue:VoiceDialog(alfred:alfred))}
 var body:some View{ZStack{Color.black.ignoresSafeArea();VStack(spacing:28){HStack{Text("ALFRED").font(.headline).tracking(4);Spacer();Button{dialog.stop();dismiss()}label:{Image(systemName:"xmark").font(.title2).frame(width:48,height:48)}.accessibilityLabel("Unterhaltung beenden")};Spacer();Image(systemName:"waveform").font(.system(size:76,weight:.light)).foregroundStyle(dialog.active ? .white:.gray);Text(dialog.status).foregroundStyle(.secondary).multilineTextAlignment(.center);if let failure=dialog.failure{Text(failure).foregroundStyle(.white).multilineTextAlignment(.center);Button("Erneut starten"){dialog.start()}.buttonStyle(.bordered)};if !dialog.active && dialog.failure==nil{Button("Unterhaltung fortsetzen"){dialog.start()}.buttonStyle(.bordered)};if !dialog.heard.isEmpty{Text(dialog.heard).font(.callout).foregroundStyle(.secondary).lineLimit(4)};Spacer();Text("Verarbeitung auf Ihrem Mac · Im Gespräch wird erkannter Text direkt gesendet.").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)}.padding(28)}.task{dialog.start()}.onReceive(NotificationCenter.default.publisher(for:AVAudioSession.interruptionNotification)){_ in dialog.stop()}.onDisappear{dialog.stop()}.onChange(of:phase){_,value in if value == .background{dialog.stop()}}}
}
