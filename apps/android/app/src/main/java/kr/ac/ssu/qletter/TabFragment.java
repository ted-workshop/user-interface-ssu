package kr.ac.ssu.qletter;

import android.os.Bundle;
import android.view.View;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.ViewCompat;
import androidx.fragment.app.Fragment;

public final class TabFragment extends Fragment {
  private static final String TAB = "tab";

  public TabFragment() {
    super(R.layout.fragment_tab);
  }

  static Fragment create(int tab) {
    TabFragment fragment = new TabFragment();
    Bundle args = new Bundle();
    args.putInt(TAB, tab);
    fragment.setArguments(args);
    return fragment;
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    int tab = requireArguments().getInt(TAB);
    TextView title = view.findViewById(R.id.tab_title);
    if (tab == R.id.tab_summary) title.setText(R.string.page_summary);
    else if (tab == R.id.tab_reports) title.setText(R.string.tab_reports);
    else if (tab == R.id.tab_channels) title.setText(R.string.tab_channels);
    else if (tab == R.id.tab_account) title.setText(R.string.tab_account);
    else title.setText(R.string.tab_home);
    ViewCompat.setAccessibilityHeading(title, true);
    if (tab == R.id.tab_account) {
      TextView status = view.findViewById(R.id.session_status);
      status.setVisibility(View.VISIBLE);
      SessionStore sessions = ((QletterApplication) requireActivity().getApplication()).sessions();
      sessions
          .changes()
          .observe(
              getViewLifecycleOwner(),
              ignored ->
                  status.setText(
                      sessions.isSignedIn()
                          ? R.string.session_signed_in
                          : R.string.session_signed_out));
    }
  }
}
