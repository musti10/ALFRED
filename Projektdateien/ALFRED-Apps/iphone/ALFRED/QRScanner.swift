import SwiftUI
import AVFoundation
struct QRScanner:UIViewControllerRepresentable {
 var found:(String)->Void
 func makeUIViewController(context:Context)->ScannerController{let controller=ScannerController();controller.found=found;return controller}
 func updateUIViewController(_ controller:ScannerController,context:Context){}
}
final class ScannerController:UIViewController,AVCaptureMetadataOutputObjectsDelegate {
 let capture=AVCaptureSession();var found:((String)->Void)?;var preview:AVCaptureVideoPreviewLayer?;var finished=false;var visible=false
 let queue=DispatchQueue(label:"alfred.qr-camera")
 override func viewWillAppear(_ animated:Bool){super.viewWillAppear(animated);visible=true}
 override func viewDidLoad(){super.viewDidLoad();view.backgroundColor = .black;AVCaptureDevice.requestAccess(for:.video){[weak self] allowed in DispatchQueue.main.async{if allowed{if self?.visible==true{self?.configure()}}else{let label=UILabel();label.text="Kamerazugriff nicht erlaubt. Verbindungsdaten können auch eingefügt werden.";label.textColor = .white;label.numberOfLines=0;label.frame=self?.view.bounds.insetBy(dx:25,dy:50) ?? .zero;self?.view.addSubview(label)}}}}
 func configure(){guard let device=AVCaptureDevice.default(for:.video),let input=try? AVCaptureDeviceInput(device:device),capture.canAddInput(input) else{return};capture.addInput(input);let output=AVCaptureMetadataOutput();guard capture.canAddOutput(output) else{return};capture.addOutput(output);output.setMetadataObjectsDelegate(self,queue:.main);output.metadataObjectTypes=[.qr];let layer=AVCaptureVideoPreviewLayer(session:capture);layer.videoGravity = .resizeAspectFill;layer.frame=view.bounds;view.layer.addSublayer(layer);preview=layer;queue.async{[weak self] in self?.capture.startRunning()}}
 override func viewDidLayoutSubviews(){super.viewDidLayoutSubviews();preview?.frame=view.bounds}
 override func viewDidDisappear(_ animated:Bool){super.viewDidDisappear(animated);visible=false;queue.async{[weak self] in self?.capture.stopRunning()}}
 func metadataOutput(_ output:AVCaptureMetadataOutput,didOutput metadataObjects:[AVMetadataObject],from connection:AVCaptureConnection){guard !finished,let code=metadataObjects.first as? AVMetadataMachineReadableCodeObject,let value=code.stringValue else{return};finished=true;queue.async{[weak self] in self?.capture.stopRunning()};found?(value)}
}
