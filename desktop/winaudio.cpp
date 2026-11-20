// winaudio.exe — Taverna na Combie
// Captura SÓ o áudio do programa dono de uma janela (e dos processos filhos dele, ex.: navegadores)
// e escreve na saída padrão em PCM 16-bit, 48 kHz, estéreo (4 bytes por amostra).
// Uso: winaudio <hwnd>   (o app passa o número da janela escolhida no seletor)
// Precisa do Windows 10 versão 2004 (build 19041) ou mais novo. Termina quando a entrada padrão fecha.
#ifndef UNICODE
#define UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <objbase.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <io.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(__has_include)
#if __has_include(<audioclientactivationparams.h>)
#include <audioclientactivationparams.h>
#define TNC_HAVE_ACAP 1
#endif
#endif
#ifndef TNC_HAVE_ACAP
typedef enum { AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1 } AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum { PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1 } PROCESS_LOOPBACK_MODE;
typedef struct { DWORD TargetProcessId; PROCESS_LOOPBACK_MODE ProcessLoopbackMode; } AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct { AUDIOCLIENT_ACTIVATION_TYPE ActivationType; union { AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams; }; } AUDIOCLIENT_ACTIVATION_PARAMS;
#endif
#ifndef VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif

// Recebe o aviso do Windows de que o "microfone virtual" do processo ficou pronto.
class ActivateHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
  LONG refs = 1;
 public:
  HANDLE done;
  HRESULT result = E_FAIL;
  IAudioClient* client = nullptr;
  ActivateHandler() { done = CreateEventW(nullptr, TRUE, FALSE, nullptr); }
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (IsEqualIID(riid, __uuidof(IUnknown)) || IsEqualIID(riid, __uuidof(IActivateAudioInterfaceCompletionHandler)))
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    else if (IsEqualIID(riid, __uuidof(IAgileObject)))
      *ppv = static_cast<IAgileObject*>(this);
    else { *ppv = nullptr; return E_NOINTERFACE; }
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return (ULONG)InterlockedIncrement(&refs); }
  STDMETHODIMP_(ULONG) Release() override { LONG r = InterlockedDecrement(&refs); if (r == 0) delete this; return (ULONG)r; }
  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT hrActivate = E_FAIL;
    IUnknown* unk = nullptr;
    HRESULT hr = op->GetActivateResult(&hrActivate, &unk);
    if (SUCCEEDED(hr) && SUCCEEDED(hrActivate) && unk) {
      result = unk->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(&client));
    } else {
      result = FAILED(hr) ? hr : hrActivate;
    }
    if (unk) unk->Release();
    SetEvent(done);
    return S_OK;
  }
};

static HANDLE g_stop = nullptr;

// Quando o app fecha (ou pede para parar), a entrada padrão fecha e a captura termina.
static DWORD WINAPI WatchStdin(LPVOID) {
  char buf[64];
  DWORD n = 0;
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  while (ReadFile(in, buf, sizeof buf, &n, nullptr) && n > 0) {}
  SetEvent(g_stop);
  return 0;
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) { fprintf(stderr, "uso: winaudio <hwnd>\n"); return 2; }
  HWND hwnd = (HWND)(ULONG_PTR)_wcstoui64(argv[1], nullptr, 0);
  DWORD pid = 0;
  if (!hwnd || !IsWindow(hwnd) || !GetWindowThreadProcessId(hwnd, &pid) || !pid) { fprintf(stderr, "janela invalida\n"); return 3; }

  _setmode(_fileno(stdout), _O_BINARY);
  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) { fprintf(stderr, "COM falhou\n"); return 4; }

  AUDIOCLIENT_ACTIVATION_PARAMS params;
  memset(&params, 0, sizeof params);
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT pv;
  PropVariantInit(&pv);
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof params;
  pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ActivateHandler* handler = new ActivateHandler();
  IActivateAudioInterfaceAsyncOperation* op = nullptr;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv, handler, &op);
  if (FAILED(hr)) { fprintf(stderr, "ativacao falhou %08lx\n", (unsigned long)hr); return 5; }
  WaitForSingleObject(handler->done, 5000);
  if (op) op->Release();
  if (FAILED(handler->result) || !handler->client) { fprintf(stderr, "ativacao falhou %08lx\n", (unsigned long)handler->result); return 5; }
  IAudioClient* client = handler->client;

  WAVEFORMATEX wf;
  memset(&wf, 0, sizeof wf);
  wf.wFormatTag = WAVE_FORMAT_PCM;
  wf.nChannels = 2;
  wf.nSamplesPerSec = 48000;
  wf.wBitsPerSample = 16;
  wf.nBlockAlign = 4;
  wf.nAvgBytesPerSec = 48000 * 4;
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                          200000, 0, &wf, nullptr);
  if (FAILED(hr)) { fprintf(stderr, "Initialize falhou %08lx\n", (unsigned long)hr); return 6; }

  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  client->SetEventHandle(ready);
  IAudioCaptureClient* capture = nullptr;
  hr = client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&capture));
  if (FAILED(hr) || !capture) { fprintf(stderr, "GetService falhou %08lx\n", (unsigned long)hr); return 7; }

  g_stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HANDLE watcher = CreateThread(nullptr, 0, WatchStdin, nullptr, 0, nullptr);
  if (watcher) CloseHandle(watcher);
  if (FAILED(client->Start())) { fprintf(stderr, "Start falhou\n"); return 8; }

  static BYTE silence[48000 * 4];  // 1 s de silêncio para pacotes marcados como "mudo"
  HANDLE waits[2] = { g_stop, ready };
  bool running = true;
  while (running) {
    DWORD w = WaitForMultipleObjects(2, waits, FALSE, 2000);
    if (w == WAIT_OBJECT_0) break;
    UINT32 packet = 0;
    while (running && SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) { running = false; break; }
      size_t bytes = (size_t)frames * 4;
      const BYTE* src = data;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) { src = silence; if (bytes > sizeof silence) bytes = sizeof silence; }
      if (bytes && fwrite(src, 1, bytes, stdout) != bytes) running = false;  // o app fechou o cano
      capture->ReleaseBuffer(frames);
    }
    if (fflush(stdout) != 0) running = false;
  }
  client->Stop();
  capture->Release();
  client->Release();
  CoUninitialize();
  return 0;
}
