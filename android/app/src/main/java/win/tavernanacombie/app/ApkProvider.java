package win.tavernanacombie.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Entrega o APK da atualização (baixado pelo app) ao instalador do Android. Só lê, só esse arquivo. */
public class ApkProvider extends ContentProvider {
    static final String FILE = "Taverna-na-Combie-update.apk";

    static Uri uriFor(Context c, File f) {
        return Uri.parse("content://" + c.getPackageName() + ".files/" + f.getName());
    }

    private File file(Uri uri) throws FileNotFoundException {
        if (!FILE.equals(uri.getLastPathSegment())) throw new FileNotFoundException();
        File f = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FILE);
        if (!f.exists()) throw new FileNotFoundException();
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        MatrixCursor c = new MatrixCursor(new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE });
        try {
            c.addRow(new Object[] { FILE, file(uri).length() });
        } catch (FileNotFoundException ignored) {
        }
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
