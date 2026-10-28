import SwiftUI
import Foundation
import Security
import CryptoKit
import AVFoundation

struct Pairing: Codable {
 let format: String; let version: Int; let host: String; let port: Int; let token: String; let pin: String
 func validate() throws {
  let pieces=host.split(separator: ".");let numbers=pieces.compactMap{Int($0)}
  let local=numbers.count==4 && numbers.allSatisfy{(0...255).contains($0)} && (numbers[0]==10 || (numbers[0]==172 && (16...31).contains(numbers[1])) || (numbers[0]==192 && numbers[1]==168) || (numbers[0]==100 && (64...127).contains(numbers[1])))
  guard format=="alfred-pairing",version==1,local,(1024...65535).contains(port),token.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,pin.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else {throw AppError.message("Ungültiger Kopplungscode. Bitte den Code aus deiner Mac-App verwenden.")}
 }
}
enum AppError: LocalizedError {case message(String);var errorDescription:String?{switch self{case .message(let text):return text}}}
enum Keychain {
 static let service="de.local.alfred.iphone",account="connection"
 static func save(_ data:Data) throws {remove();let item:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:account,kSecValueData as String:data,kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly];guard SecItemAdd(item as CFDictionary,nil)==errSecSuccess else{throw AppError.message("Kopplung konnte nicht im Schlüsselbund gespeichert werden.")}}
 static func read()->Data?{let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:account,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne];var value:CFTypeRef?;guard SecItemCopyMatching(query as CFDictionary,&value)==errSecSuccess else{return nil};return value as? Data}
 static func remove(){SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:account] as CFDictionary)}
}
final class API:NSObject,URLSessionDelegate,@unchecked Sendable {
 let pairing:Pairing
 lazy var session:URLSession={let configuration=URLSessionConfiguration.ephemeral;configuration.waitsForConnectivity=true;configuration.timeoutIntervalForRequest=190;configuration.timeoutIntervalForResource=200;return URLSession(configuration:configuration,delegate:self,delegateQueue:nil)}()
 init(_ pairing:Pairing){self.pairing=pairing}
 func close(){session.invalidateAndCancel()}
 func urlSession(_ session:URLSession,didReceive challenge:URLAuthenticationChallenge,completionHandler:@escaping(URLSession.AuthChallengeDisposition,URLCredential?)->Void){
     guard challenge.protectionSpace.authenticationMethod==NSURLAuthenticationMethodServerTrust,challenge.protectionSpace.host==pairing.host,let trust=challenge.protectionSpace.serverTrust,let chain=SecTrustCopyCertificateChain(trust) as? [SecCertificate],let certificate=chain.first else{completionHandler(.cancelAuthenticationChallenge,nil);return}
  let bytes=SecCertificateCopyData(certificate) as Data;let actual=SHA256.hash(data:bytes).map{String(format:"%02x",$0)}.joined()
  guard actual==pairing.pin else{completionHandler(.cancelAuthenticationChallenge,nil);return}
  completionHandler(.useCredential,URLCredential(trust:trust))
 }
 func call<T:Decodable>(_ path:String,method:String="GET",body:[String:Any]?=nil)async throws->T{
  guard let url=URL(string:"https://\(pairing.host):\(pairing.port)\(path)") else{throw AppError.message("Ungültige Verbindung.")}
  var request=URLRequest(url:url);request.httpMethod=method;request.setValue("Bearer \(pairing.token)",forHTTPHeaderField:"Authorization")
  if let body{request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try JSONSerialization.data(withJSONObject:body)}
  let(data,response)=try await session.data(for:request)
  guard let http=response as? HTTPURLResponse,(200...299).contains(http.statusCode) else{let message=(try? JSONDecoder().decode(ErrorReply.self,from:data).error) ?? "Mac nicht erreichbar. WLAN und Freigabe prüfen.";throw AppError.message(message)}
  return try JSONDecoder().decode(T.self,from:data)
 }
 func binary(_ path:String,body:Data,type:String)async throws->Data {
  guard let url=URL(string:"https://\(pairing.host):\(pairing.port)\(path)") else{throw AppError.message("Ungültige Verbindung.")}
  var request=URLRequest(url:url);request.httpMethod="POST";request.setValue("Bearer \(pairing.token)",forHTTPHeaderField:"Authorization");request.setValue(type,forHTTPHeaderField:"Content-Type");request.httpBody=body
  let(data,response)=try await session.data(for:request)
  guard let http=response as? HTTPURLResponse,(200...299).contains(http.statusCode) else {throw AppError.message((try? JSONDecoder().decode(ErrorReply.self,from:data).error) ?? "Sprachverbindung fehlgeschlagen.")}
  guard data.count<=8_000_000 else{throw AppError.message("Sprachausgabe zu groß.")};return data
 }

}
struct ErrorReply:Decodable{let error:String}
struct Chat:Decodable,Identifiable{let id:String;let title:String}
struct Message:Decodable,Identifiable{let id:String;let role:String;let content:String;let source:String?;var author:String{role=="user" ? (source=="hermes" ? "SIE → HERMES":"SIE"):(source=="hermes" ? "HERMES · LOKAL":"ALFRED")}}
struct Memory:Decodable,Identifiable{let id:String;let content:String;let enabled:Int}
struct Todo:Decodable,Identifiable{let id:String;let day:String;let text:String;let time:String;let done:Int}
struct ServerState:Decodable{let chats:[Chat];let memories:[Memory];let busy:Bool}
struct Ack:Decodable{let ok:Bool?;let id:String?;let added:Int?}

@MainActor final class Alfred:ObservableObject {
 @Published var connection:Pairing?;@Published var chats:[Chat]=[];@Published var memories:[Memory]=[];@Published var messages:[Message]=[];@Published var tasks:[Todo]=[]
 @Published var selected:String?;@Published var draft="";@Published var error:String?;@Published var sending=false;@Published var connecting=false
 var api:API?
 init(){if let data=Keychain.read(),let saved=try? JSONDecoder().decode(Pairing.self,from:data),(try? saved.validate()) != nil{connection=saved;api=API(saved)}}
 func connect(_ text:String)async{connecting=true;defer{connecting=false};do{let data=Data(text.utf8);let pair=try JSONDecoder().decode(Pairing.self,from:data);try pair.validate();let candidate=API(pair);do{let state:ServerState=try await candidate.call("/api/state");try Keychain.save(data);api?.close();api=candidate;connection=pair;chats=state.chats;memories=state.memories;selected=chats.first?.id;await loadMessages()}catch{candidate.close();throw error}}catch{self.error=error.localizedDescription}}
 func disconnect(){api?.close();api=nil;connection=nil;Keychain.remove();chats=[];memories=[];messages=[];tasks=[];selected=nil;draft=""}
 func refresh()async{guard let api else{return};do{let state:ServerState=try await api.call("/api/state");chats=state.chats;memories=state.memories;if !chats.contains(where:{$0.id==selected}){selected=chats.first?.id};await loadMessages()}catch{self.error=error.localizedDescription}}
 func loadMessages()async{guard let api,let selected else{messages=[];return};do{messages=try await api.call("/api/chats/\(selected)")}catch{self.error=error.localizedDescription}}
 func newChat()async{guard let api else{return};do{let reply:Ack=try await api.call("/api/chats",method:"POST",body:[:]);selected=reply.id;await refresh()}catch{self.error=error.localizedDescription}}
 func send()async{guard let api,!sending,!draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{return};let text=draft;sending=true;defer{sending=false};do{if selected==nil{let reply:Ack=try await api.call("/api/chats",method:"POST",body:[:]);selected=reply.id};try Task.checkCancellation();guard let selected else{return};let _:Ack=try await api.call("/api/chats/\(selected)/messages",method:"POST",body:["content":text]);draft="";await refresh()}catch{self.error=Task.isCancelled ? "Gestoppt. Dein Entwurf bleibt erhalten.":error.localizedDescription}}
 func loadTasks(_ date:Date)async{guard let api else{return};do{tasks=try await api.call("/api/tasks?day="+day(date))}catch{self.error=error.localizedDescription}}
 func addTask(_ text:String,time:String,date:Date)async{guard let api else{return};do{let _:Ack=try await api.call("/api/tasks",method:"POST",body:["day":day(date),"tasks":[["text":text,"time":time]]]);await loadTasks(date)}catch{self.error=error.localizedDescription}}
 func toggle(_ task:Todo,date:Date)async{guard let api else{return};do{let _:Ack=try await api.call("/api/tasks/\(task.id)",method:"PATCH",body:["text":task.text,"time":task.time,"done":task.done==0]);await loadTasks(date)}catch{self.error=error.localizedDescription}}
 func toggle(_ memory:Memory)async{guard let api else{return};do{let _:Ack=try await api.call("/api/memories/\(memory.id)",method:"PATCH",body:["content":memory.content,"enabled":memory.enabled==0]);await refresh()}catch{self.error=error.localizedDescription}}
 func remember(_ text:String)async{guard let api else{return};do{let _:Ack=try await api.call("/api/memories",method:"POST",body:["content":text]);await refresh()}catch{self.error=error.localizedDescription}}
 func day(_ date:Date)->String{let formatter=DateFormatter();formatter.calendar=Calendar(identifier:.gregorian);formatter.locale=Locale(identifier:"en_US_POSIX");formatter.dateFormat="yyyy-MM-dd";return formatter.string(from:date)}
}

@main struct ALFREDApp:App {
 @StateObject var alfred=Alfred()
 var body:some Scene{WindowGroup{RootView().environmentObject(alfred).preferredColorScheme(.dark).tint(Color(white:0.92))}}
}
struct RootView:View {
 @EnvironmentObject var alfred:Alfred
 var body:some View{Group{if alfred.connection==nil{PairView()}else{TabView{ChatView().tabItem{Label("Gespräche",systemImage:"bubble.left.and.bubble.right")};TaskView().tabItem{Label("Tagesplan",systemImage:"checklist")};MemoryView().tabItem{Label("Gedächtnis",systemImage:"brain")};ConnectionView().tabItem{Label("Verbindung",systemImage:"wifi")}}.task{await alfred.refresh()}}}.alert("ALFRED",isPresented:Binding(get:{alfred.error != nil},set:{if !$0{alfred.error=nil}})){Button("OK"){alfred.error=nil}}message:{Text(alfred.error ?? "")}}
}
struct PairView:View {
 @EnvironmentObject var alfred:Alfred;@State var code="";@State var scanner=false
 var body:some View{NavigationStack{ScrollView{VStack(spacing:22){Image("ALFREDMark").resizable().scaledToFit().frame(width:88,height:88).accessibilityHidden(true);Text("ALFRED").font(.largeTitle);Text("Dein Assistent auf deinem Mac.\nHier auf deinem iPhone erreichbar.").multilineTextAlignment(.center).foregroundStyle(.secondary);Text("Mac-App öffnen → Menü ALFRED → iPhone verbinden. Für unterwegs Tailscale auf beiden Geräten verbinden.").font(.callout);Button("QR-Code scannen",systemImage:"qrcode.viewfinder"){scanner=true}.buttonStyle(.borderedProminent);Text("Oder Verbindungsdaten vom Mac hier einfügen:").font(.caption);TextEditor(text:$code).frame(height:110).font(.caption.monospaced()).autocorrectionDisabled().textInputAutocapitalization(.never).accessibilityLabel("Verbindungsdaten");Button(alfred.connecting ? "Verbindet …":"Verbinden"){Task{await alfred.connect(code)}}.disabled(alfred.connecting||code.isEmpty);Text("Verschlüsselte lokale Verbindung. Der Mac muss eingeschaltet bleiben. Keine Cloud.").font(.caption).foregroundStyle(.secondary)}.padding()}.navigationTitle("Willkommen").sheet(isPresented:$scanner){QRScanner{result in scanner=false;code=result;Task{await alfred.connect(result)}}}}}
}
struct ChatView:View {
 @EnvironmentObject var alfred:Alfred;@State var operation:Task<Void,Never>?;@State var voice=false
 var body:some View{NavigationStack{VStack{if !alfred.chats.isEmpty{Picker("Gespräch",selection:Binding(get:{alfred.selected ?? ""},set:{alfred.selected=$0;Task{await alfred.loadMessages()}})){ForEach(alfred.chats){Text($0.title).tag($0.id)}}.disabled(alfred.sending).padding(.horizontal)}
 ScrollViewReader{proxy in ScrollView{LazyVStack(alignment:.leading,spacing:16){ForEach(alfred.messages){message in VStack(alignment:.leading,spacing:6){Text(message.author).font(.caption).foregroundStyle(.secondary);Text(message.content).textSelection(.enabled)}.padding().frame(maxWidth:.infinity,alignment:.leading).background(message.role=="user" ? Color.white.opacity(0.06):Color.gray.opacity(0.12)).clipShape(RoundedRectangle(cornerRadius:12)).id(message.id)};if alfred.sending{ProgressView("ALFRED denkt nach …")}}.padding()}.onChange(of:alfred.messages.count){_,_ in if let last=alfred.messages.last{proxy.scrollTo(last.id,anchor:.bottom)}}}
 HStack(alignment:.bottom){Button{voice=true}label:{Image(systemName:"waveform").font(.title2).frame(width:44,height:44)}.accessibilityLabel("Sprachunterhaltung starten").disabled(alfred.sending || !alfred.draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty);TextField("Nachricht an ALFRED",text:$alfred.draft,axis:.vertical).lineLimit(1...6).textFieldStyle(.roundedBorder).disabled(alfred.sending);if alfred.sending{Button("Stopp"){operation?.cancel()}}else{Button("Senden"){operation=Task{await alfred.send()}}.disabled(alfred.draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty||alfred.draft.count>4000)}}.padding();Text("Antworten können Fehler enthalten.").font(.caption2).foregroundStyle(.secondary)}.navigationTitle("ALFRED").toolbar{ToolbarItem(placement:.topBarTrailing){Button("Neues Gespräch",systemImage:"plus"){Task{await alfred.newChat()}}.disabled(alfred.sending)}}.refreshable{await alfred.refresh()}.fullScreenCover(isPresented:$voice){VoiceDialogView(alfred:alfred)}}}
}
struct TaskView:View {
 @EnvironmentObject var alfred:Alfred;@State var date=Date();@State var text="";@State var time=""
 var body:some View{NavigationStack{List{Section{DatePicker("Datum",selection:$date,displayedComponents:.date).onChange(of:date){_,new in Task{await alfred.loadTasks(new)}}};Section("Aufgaben"){if alfred.tasks.isEmpty{Text("Noch keine Aufgaben.").foregroundStyle(.secondary)};ForEach(alfred.tasks){task in Button{Task{await alfred.toggle(task,date:date)}}label:{HStack{Image(systemName:task.done==1 ? "checkmark.circle.fill":"circle");Text((task.time.isEmpty ? "":task.time+" · ")+task.text).strikethrough(task.done==1)}}}};Section("Neue Aufgabe"){TextField("Was möchtest du tun?",text:$text);TextField("Uhrzeit, optional: 09:00",text:$time).keyboardType(.numbersAndPunctuation);Button("Hinzufügen"){Task{await alfred.addTask(text,time:time,date:date);if alfred.error==nil{text="";time=""}}}.disabled(text.isEmpty||text.count>400)};Section{Text("Keine automatischen Benachrichtigungen. Aufgaben werden auf deinem Mac gespeichert.").font(.caption).foregroundStyle(.secondary)}}.navigationTitle("Mein Tagesplan").task{await alfred.loadTasks(date)}.refreshable{await alfred.loadTasks(date)}}
}
}
struct MemoryView:View {
 @EnvironmentObject var alfred:Alfred;@State var text=""
 var body:some View{NavigationStack{List{Section{Text("Nur bewusst gespeicherte und aktivierte Fakten werden in neuen Antworten berücksichtigt.").font(.callout)};ForEach(alfred.memories){memory in Toggle(isOn:Binding(get:{memory.enabled==1},set:{_ in Task{await alfred.toggle(memory)}})){Text(memory.content)}};Section("Neue Erinnerung"){TextField("Was soll ALFRED wissen?",text:$text,axis:.vertical);Button("Bewusst speichern"){Task{await alfred.remember(text);if alfred.error==nil{text=""}}}.disabled(text.isEmpty||text.count>500)}}.navigationTitle("Langzeitgedächtnis").refreshable{await alfred.refresh()}}
}
}
struct ConnectionView:View {
 @EnvironmentObject var alfred:Alfred;@State var confirm=false
 var body:some View{NavigationStack{Form{Section("Dein Mac"){Text(alfred.connection?.host ?? "");Text("Verbindung über HTTPS mit geprüftem Zertifikatsfingerabdruck.").font(.caption)};Section{Text("Der Mac und die Mac-App müssen erreichbar sein. Die Kopplung bleibt gespeichert, bis sie auf dem Mac widerrufen wird. Für mobile Daten Tailscale auf beiden Geräten aktivieren. Der Mac muss wach und ALFRED geöffnet sein.");Button("Verbindung prüfen"){Task{await alfred.refresh()}};Button("Kopplung entfernen",role:.destructive){confirm=true}};Section{Text("Diese erste iPhone-Version unterstützt Chat, Aufgaben und bewusst gespeicherte Erinnerungen. Über das Sprachwellensymbol im Chat kannst du mit ALFRED sprechen. Dateiimport und Sicherungen verwendest du am Mac.").font(.caption)}}.navigationTitle("Verbindung").confirmationDialog("Kopplung auf diesem iPhone entfernen? Deine Daten auf dem Mac bleiben erhalten.",isPresented:$confirm,titleVisibility:.visible){Button("Kopplung entfernen",role:.destructive){alfred.disconnect()}}}}
}
